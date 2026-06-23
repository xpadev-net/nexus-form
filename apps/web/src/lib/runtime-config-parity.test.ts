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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
      const result = spawnSync(
        "sh",
        [join(repoRoot, "apps/web/docker-entrypoint.sh"), "true"],
        {
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
        },
      );

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
