import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRuntimeConfig } from "./runtime-config-script";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const dockerEntrypointPath = join(repoRoot, "apps/web/docker-entrypoint.sh");
const k8sConfigMapPath = join(repoRoot, "k8s/base/configmap.yaml");
const k8sWebDeploymentPath = join(repoRoot, "k8s/base/web-deployment.yaml");

const runtimeConfigBackedBuildEnv = [
  "VITE_API_URL",
  "VITE_BASE_URL",
  "VITE_FORM_SECURITY_DEV_BYPASS",
  "VITE_HCAPTCHA_SITE_KEY",
  "VITE_TELEMETRY_HOST",
  "VITE_TELEMETRY_V4_HOST",
  "VITE_TELEMETRY_V6_HOST",
] as const;

const runtimeBrandBuildEnv = [
  "VITE_BRAND_APP_NAME",
  "VITE_BRAND_PRIMARY_COLOR",
  "VITE_BRAND_SECONDARY_COLOR",
  "VITE_BRAND_ACCENT_COLOR",
  "VITE_BRAND_TERMS_URL",
  "VITE_BRAND_PRIVACY_URL",
  "VITE_BRAND_COPYRIGHT",
  "VITE_BRAND_HOMEPAGE_URL",
] as const;

const buildArtifactOnlyEnv = ["VITE_DISABLE_HCAPTCHA"] as const;

const deploymentOnlyRuntimeConfigEnv = new Set([
  "VITE_FORM_SECURITY_DEV_BYPASS",
]);

const webBuildTimeEnv = [
  ...runtimeConfigBackedBuildEnv,
  ...runtimeBrandBuildEnv,
  ...buildArtifactOnlyEnv,
];

const runtimeEnv = {
  VITE_API_URL: "https://api.runtime.example",
  VITE_BASE_URL: "https://frontend.runtime.example/app",
  VITE_FORM_SECURITY_DEV_BYPASS: "false",
  VITE_HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
  VITE_TELEMETRY_HOST: "telemetry.runtime.example",
  VITE_TELEMETRY_V4_HOST: "ipv4.runtime.example",
  VITE_TELEMETRY_V6_HOST: "ipv6.runtime.example",
};

type WindowShim = {
  __NEXUS_FORM_CONFIG__?: unknown;
  __BRAND_CONFIG__?: unknown;
};

type KubernetesConfigMapEnvRef = {
  configMapName: string;
  envName: string;
  key: string;
  optional: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function leadingSpaceCount(line: string): number {
  return line.length - line.trimStart().length;
}

function isYamlContentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

function parseYamlMapping(
  line: string,
): { key: string; value: string | undefined } | undefined {
  const trimmed = line.trim();
  const mappingText = trimmed.startsWith("- ")
    ? trimmed.slice(2).trimStart()
    : trimmed;
  const match = mappingText.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
  if (!match?.[1]) return undefined;

  return {
    key: match[1],
    value: match[2],
  };
}

function readYamlScalarValue(value: string | undefined): string {
  const scalar = value?.trim() ?? "";
  if (scalar.startsWith('"') && scalar.endsWith('"')) {
    return scalar.slice(1, -1);
  }
  return scalar;
}

function readTurboBuildEnv(): string[] {
  const turboConfig = JSON.parse(
    readFileSync(join(repoRoot, "turbo.json"), "utf8"),
  );
  if (!isRecord(turboConfig)) return [];

  const tasks = turboConfig.tasks;
  if (!isRecord(tasks)) return [];

  const build = tasks.build;
  if (!isRecord(build)) return [];

  const env = build.env;
  if (!Array.isArray(env)) return [];

  return env.filter((value): value is string => typeof value === "string");
}

function readDockerEntrypointRuntimeEnv(): string[] {
  const entrypoint = readFileSync(dockerEntrypointPath, "utf8");
  const runtimeConfigBlock = entrypoint.match(
    /window\.__NEXUS_FORM_CONFIG__ = \{\n(?<body>[\s\S]*?)\n\};/,
  );
  const body = runtimeConfigBlock?.groups?.body;
  if (!body) {
    throw new Error(
      "Unable to find window.__NEXUS_FORM_CONFIG__ in Docker entrypoint",
    );
  }

  const envNames = new Set<string>();
  for (const match of body.matchAll(
    /\b[A-Za-z][A-Za-z0-9]*:\s+\$\(json_encode "\$\{([A-Z0-9_]+):-\}"\),?/g,
  )) {
    const envName = match[1];
    if (!envName) {
      throw new Error("Unable to read runtime env name from Docker entrypoint");
    }
    envNames.add(envName);
  }

  return sortStrings(envNames);
}

function readKubernetesConfigMapDataKeys(): Set<string> {
  const configMap = readFileSync(k8sConfigMapPath, "utf8");
  const keys = new Set<string>();
  let dataIndent: number | undefined;
  let dataKeyIndent: number | undefined;

  for (const line of configMap.split("\n")) {
    if (!isYamlContentLine(line)) continue;

    const indent = leadingSpaceCount(line);
    const mapping = parseYamlMapping(line);

    if (dataIndent === undefined) {
      if (mapping?.key === "data") {
        dataIndent = indent;
      }
      continue;
    }

    if (indent <= dataIndent) break;

    dataKeyIndent ??= indent;
    if (indent !== dataKeyIndent) continue;

    if (mapping?.key && /^[A-Z0-9_]+$/.test(mapping.key)) {
      keys.add(mapping.key);
    }
  }

  if (dataIndent === undefined) {
    throw new Error("Unable to find data block in k8s/base/configmap.yaml");
  }
  if (keys.size === 0) {
    throw new Error("No keys found under data in k8s/base/configmap.yaml");
  }

  return keys;
}

function readWebDeploymentConfigMapEnvRefs(): KubernetesConfigMapEnvRef[] {
  const deployment = readFileSync(k8sWebDeploymentPath, "utf8");
  const refs: KubernetesConfigMapEnvRef[] = [];

  let envName: string | undefined;
  let configMapName: string | undefined;
  let key: string | undefined;
  let envIndent: number | undefined;
  let configMapKeyRefIndent: number | undefined;
  let optional = false;

  const pushCurrentRef = () => {
    if (!envName || !configMapName || !key) return;

    refs.push({
      configMapName,
      envName,
      key,
      optional,
    });
  };

  const resetCurrentRef = () => {
    envName = undefined;
    configMapName = undefined;
    key = undefined;
    configMapKeyRefIndent = undefined;
    optional = false;
  };

  for (const line of deployment.split("\n")) {
    if (!isYamlContentLine(line)) continue;

    const indent = leadingSpaceCount(line);
    const trimmed = line.trim();
    const mapping = parseYamlMapping(line);

    if (envIndent === undefined) {
      if (mapping?.key === "env") {
        envIndent = indent;
      }
      continue;
    }

    if (
      indent < envIndent ||
      (indent <= envIndent && !trimmed.startsWith("- "))
    ) {
      pushCurrentRef();
      resetCurrentRef();
      envIndent = undefined;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      pushCurrentRef();
      resetCurrentRef();

      if (mapping?.key === "name") {
        envName = readYamlScalarValue(mapping.value);
      }
      continue;
    }

    if (!envName) continue;

    if (mapping?.key === "configMapKeyRef") {
      configMapKeyRefIndent = indent;
      continue;
    }

    if (configMapKeyRefIndent === undefined) continue;
    if (indent <= configMapKeyRefIndent) {
      configMapKeyRefIndent = undefined;
      continue;
    }

    if (mapping?.key === "name") {
      configMapName = readYamlScalarValue(mapping.value);
      continue;
    }

    if (mapping?.key === "key") {
      key = readYamlScalarValue(mapping.value);
      continue;
    }

    if (mapping?.key === "optional") {
      optional = readYamlScalarValue(mapping.value) === "true";
    }
  }

  pushCurrentRef();

  return refs;
}

function evaluateEnvConfig(script: string): WindowShim {
  const windowShim: WindowShim = {};
  runInNewContext(script, { window: windowShim });
  return windowShim;
}

describe("web runtime build env parity", () => {
  it("lists every Web Vite env that can change the build artifact in Turbo build cache inputs", () => {
    expect(readTurboBuildEnv()).toEqual(
      expect.arrayContaining(webBuildTimeEnv),
    );
  });

  it("keeps Docker entrypoint runtime config keys in parity with build-time runtime config", () => {
    expect(readDockerEntrypointRuntimeEnv()).toEqual(
      sortStrings(runtimeConfigBackedBuildEnv),
    );
  });

  it("keeps Kubernetes Web runtime config env in parity with Docker entrypoint runtime config", () => {
    const configMapKeys = readKubernetesConfigMapDataKeys();
    const deploymentEnvRefs = readWebDeploymentConfigMapEnvRefs();
    const nexusConfigRefs = deploymentEnvRefs.filter(
      (ref) => ref.configMapName === "nexus-form-config",
    );
    const refsByEnvName = new Map(
      nexusConfigRefs.map((ref) => [ref.envName, ref]),
    );
    const dockerRuntimeEnv = readDockerEntrypointRuntimeEnv();

    for (const envName of dockerRuntimeEnv) {
      const ref = refsByEnvName.get(envName);
      if (!ref) {
        throw new Error(
          `${envName} is read by Docker entrypoint but is missing from k8s/base/web-deployment.yaml`,
        );
      }

      expect(ref.configMapName).toBe("nexus-form-config");
      expect(ref.key).toBe(envName);

      if (!deploymentOnlyRuntimeConfigEnv.has(envName)) {
        expect(configMapKeys.has(envName)).toBe(true);
      }

      if (!configMapKeys.has(ref.key)) {
        expect(deploymentOnlyRuntimeConfigEnv.has(ref.key)).toBe(true);
        expect(ref.optional).toBe(true);
      }
    }

    for (const ref of nexusConfigRefs) {
      expect(ref.key).toBe(ref.envName);
      if (!configMapKeys.has(ref.key)) {
        expect(deploymentOnlyRuntimeConfigEnv.has(ref.key)).toBe(true);
        expect(ref.optional).toBe(true);
      }
    }
  });

  it("keeps Docker runtime config keys in parity with build-time runtime config", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "nexus-form-web-entrypoint-"));
    const webRoot = join(tempRoot, "html");
    const securityHeadersPath = join(tempRoot, "spa-security-headers.conf");
    mkdirSync(webRoot);
    writeFileSync(
      securityHeadersPath,
      "img-src __CSP_IMG_SRC__;\nconnect-src __CSP_CONNECT_SRC__;\n",
    );

    try {
      const result = spawnSync("sh", [dockerEntrypointPath, "true"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ...runtimeEnv,
          SPA_SECURITY_HEADERS_PATH: securityHeadersPath,
          VITE_BRAND_APP_NAME: "Runtime Brand",
          VITE_BRAND_PRIMARY_COLOR: "#123456",
          VITE_BRAND_SECONDARY_COLOR: "#654321",
          VITE_BRAND_ACCENT_COLOR: "#abcdef",
          VITE_BRAND_TERMS_URL: "https://runtime.example/terms",
          VITE_BRAND_PRIVACY_URL: "https://runtime.example/privacy",
          VITE_BRAND_COPYRIGHT: "Runtime Copyright",
          VITE_BRAND_HOMEPAGE_URL: "https://runtime.example",
          WEB_ROOT: webRoot,
        },
      });

      expect(result.status, result.stderr).toBe(0);

      const generatedScript = readFileSync(
        join(webRoot, "env-config.js"),
        "utf8",
      );
      const windowShim = evaluateEnvConfig(generatedScript);
      const dockerRuntimeConfig = windowShim.__NEXUS_FORM_CONFIG__;
      const buildRuntimeConfig = createRuntimeConfig(runtimeEnv);

      expect(dockerRuntimeConfig).toEqual(buildRuntimeConfig);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
