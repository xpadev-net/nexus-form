import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(testDir, "../../../../../");
const workerRoot = resolve(repoRoot, "apps/worker");

const workerDeployments = [
  ["bullmq-validation-discord-deployment.yaml", "discord-validation"],
  ["bullmq-validation-github-deployment.yaml", "github-validation"],
  ["bullmq-validation-twitter-deployment.yaml", "twitter-validation"],
  ["bullmq-sheets-deployment.yaml", "google-sheets-sync"],
] as const;

const apiAndWorkerDeploymentManifests = [
  "api-deployment.yaml",
  ...workerDeployments.map(([manifestName]) => manifestName),
] as const;

const configMapManifest = readFileSync(
  resolve(repoRoot, "k8s/base/configmap.yaml"),
  "utf8",
);
const secretManifest = readFileSync(
  resolve(repoRoot, "k8s/base/secret.yaml"),
  "utf8",
);
const kustomizationManifest = readFileSync(
  resolve(repoRoot, "k8s/base/kustomization.yaml"),
  "utf8",
);

function readManifest(manifestName: string): string {
  return readFileSync(resolve(repoRoot, "k8s/base", manifestName), "utf8");
}

function readWorkerEntrypoint(manifestName: string): string {
  const manifest = readManifest(manifestName);
  const argsLine = manifest.match(/^\s*args:\s*\[(?<args>[^\]]+)\]/m);
  if (!argsLine?.groups?.args) {
    throw new Error(`Missing args in ${manifestName}`);
  }

  const args = Array.from(argsLine.groups.args.matchAll(/"([^"]+)"/g)).map(
    (match) => match[1],
  );
  const entrypoint = args.at(-1);
  if (!entrypoint?.startsWith("src/")) {
    throw new Error(`Missing worker source entrypoint in ${manifestName}`);
  }
  return entrypoint;
}

function readWorkerQueuesEnv(manifestName: string): string {
  const manifest = readManifest(manifestName);
  const envValue = manifest.match(
    /^\s*-\s*name:\s*WORKER_QUEUES\s*\n\s*value:\s*"(?<value>[^"]+)"/m,
  );
  if (!envValue?.groups?.value) {
    throw new Error(`Missing WORKER_QUEUES in ${manifestName}`);
  }
  return envValue.groups.value;
}

function readSecretNameWithGoogleOAuthKey(): string {
  const manifest = readManifest("secret.yaml");
  const secretName = manifest.match(
    /^metadata:\s*\n(?:^\s{2}.+\n)*?^\s{2}name:\s*(?<name>\S+)\s*$/m,
  )?.groups?.name;
  if (!secretName) {
    throw new Error("Missing Secret metadata.name in secret.yaml");
  }
  if (!/^\s{2}GOOGLE_OAUTH_ENC_KEY:\s*/m.test(manifest)) {
    throw new Error("Missing GOOGLE_OAUTH_ENC_KEY in secret.yaml stringData");
  }
  return secretName;
}

function readDeploymentSecretRefs(manifestName: string): string[] {
  const manifest = readManifest(manifestName);
  return Array.from(
    manifest.matchAll(/^\s*-\s*secretRef:\s*\n\s*name:\s*(?<name>\S+)/gm),
  ).map((match) => match.groups?.name ?? "");
}

function readDeploymentConfigMapRefs(manifestName: string): string[] {
  const manifest = readManifest(manifestName);
  return Array.from(
    manifest.matchAll(/^\s*-\s*configMapRef:\s*\n\s*name:\s*(?<name>\S+)/gm),
  ).map((match) => match.groups?.name ?? "");
}

function readDeploymentConfigMapKeyRefs(manifestName: string): string[] {
  const manifest = readManifest(manifestName);
  return Array.from(
    manifest.matchAll(
      /^\s*configMapKeyRef:\s*\n\s*name:\s*nexus-form-config\s*\n\s*key:\s*(?<key>\S+)/gm,
    ),
  ).map((match) => match.groups?.key ?? "");
}

function readManifestValue(
  manifest: string,
  manifestName: string,
  key: string,
): string {
  const value = manifest.match(
    new RegExp(`^\\s{2}${key}:\\s*"(?<value>[^"]*)"\\s*$`, "m"),
  )?.groups?.value;
  if (value === undefined) {
    throw new Error(`Missing ${key} in ${manifestName}`);
  }
  return value;
}

function readConfigMapValue(key: string): string {
  return readManifestValue(configMapManifest, "configmap.yaml", key);
}

function readSecretValue(key: string): string {
  return readManifestValue(secretManifest, "secret.yaml", key);
}

function readKustomizationResources(): string[] {
  const resourcesBlock = kustomizationManifest.match(
    /^resources:\n(?<resources>(?:\s{2}-\s+\S+\n?)+)/m,
  )?.groups?.resources;
  if (!resourcesBlock) {
    throw new Error("Missing resources in kustomization.yaml");
  }
  return Array.from(resourcesBlock.matchAll(/^\s{2}-\s+(?<name>\S+)$/gm)).map(
    (match) => match.groups?.name ?? "",
  );
}

function buildKustomization(relativePath: string): string {
  return execFileSync("kustomize", ["build", resolve(repoRoot, relativePath)], {
    encoding: "utf8",
  });
}

function hasKustomizeBinary(): boolean {
  try {
    execFileSync("kustomize", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const kustomizeAvailable = hasKustomizeBinary();

describe("k8s worker deployments", () => {
  it.each(
    workerDeployments,
  )("%s starts an existing worker entrypoint", (manifestName) => {
    const entrypoint = readWorkerEntrypoint(manifestName);

    expect(existsSync(resolve(workerRoot, entrypoint))).toBe(true);
  });

  it.each(
    workerDeployments,
  )("%s selects only its intended queue", (manifestName, expectedQueue) => {
    expect(readWorkerQueuesEnv(manifestName)).toBe(expectedQueue);
  });

  it.each(
    apiAndWorkerDeploymentManifests,
  )("%s injects the shared secret for Google OAuth encryption", (manifestName) => {
    const secretName = readSecretNameWithGoogleOAuthKey();

    expect(readDeploymentSecretRefs(manifestName)).toContain(secretName);
  });

  it("defines Redis URL in ConfigMap and Redis password in Secret", () => {
    expect(readConfigMapValue("REDIS_URL")).toBe("redis://redis-service:6379");
    expect(readSecretValue("REDIS_PASSWORD")).toBe("");
  });

  it.each(
    apiAndWorkerDeploymentManifests,
  )("%s receives Redis URL config and Redis password secret", (manifestName) => {
    expect(readDeploymentConfigMapRefs(manifestName)).toContain(
      "nexus-form-config",
    );
    expect(readDeploymentSecretRefs(manifestName)).toContain(
      "nexus-form-secrets",
    );
  });
});

describe("k8s base manifest render", () => {
  it("references each expected resource exactly once", () => {
    const resources = readKustomizationResources();
    const expectedResources = [
      "configmap.yaml",
      "secret.yaml",
      "api-deployment.yaml",
      "api-service.yaml",
      "web-deployment.yaml",
      "web-service.yaml",
      "bullmq-validation-discord-deployment.yaml",
      "bullmq-validation-github-deployment.yaml",
      "bullmq-validation-twitter-deployment.yaml",
      "bullmq-sheets-deployment.yaml",
    ];

    expect(new Set(resources)).toEqual(new Set(expectedResources));
    expect(resources).toHaveLength(expectedResources.length);
  });

  it.skipIf(!kustomizeAvailable).each(["k8s/base", "k8s/overlays/production"])(
    "builds %s with kustomize",
    (kustomizationPath) => {
      const rendered = buildKustomization(kustomizationPath);

      expect(rendered).toContain("kind: ConfigMap");
      expect(rendered).toContain("kind: Secret");
      expect(rendered).toContain("kind: Deployment");
      expect(rendered).toContain("kind: Service");
      expect(rendered).toContain("name: api\n");
      expect(rendered).toContain("name: web\n");
      expect(rendered).toContain("name: bullmq-validation-discord\n");
      expect(rendered).toContain("name: bullmq-validation-github\n");
      expect(rendered).toContain("name: bullmq-validation-twitter\n");
      expect(rendered).toContain("name: bullmq-sheets\n");
      expect(rendered).not.toContain("{{");
      expect(rendered).not.toContain("}}");
    },
  );
});

describe("k8s web runtime configuration", () => {
  it("injects only browser runtime keys into the web Deployment", () => {
    expect(readDeploymentConfigMapRefs("web-deployment.yaml")).not.toContain(
      "nexus-form-config",
    );
    expect(readDeploymentConfigMapKeyRefs("web-deployment.yaml")).toEqual([
      "VITE_API_URL",
      "VITE_HCAPTCHA_SITE_KEY",
    ]);
  });

  it("defines Vite runtime keys and keeps the invitation code in Secret", () => {
    expect(configMapManifest).toMatch(/^\s{2}VITE_API_URL:\s*/m);
    expect(configMapManifest).toMatch(/^\s{2}VITE_HCAPTCHA_SITE_KEY:\s*/m);
    expect(configMapManifest).not.toMatch(
      /^\s{2}NEXT_PUBLIC_HCAPTCHA_SITE_KEY:\s*/m,
    );
    expect(configMapManifest).not.toMatch(/^\s{2}SIGNUP_INVITATION_CODE:\s*/m);
    expect(secretManifest).toMatch(/^\s{2}SIGNUP_INVITATION_CODE:\s*/m);
  });

  it("uses a browser-reachable API origin for runtime config", () => {
    const apiUrl = readConfigMapValue("VITE_API_URL");
    const hostname = new URL(apiUrl).hostname;

    expect(apiUrl).not.toBe("http://api:3001");
    expect(apiUrl).toMatch(/^https?:\/\/[^.]+\.[^/]+/);
    expect(hostname).not.toBe("api");
    expect(hostname).not.toMatch(/(?:^|\.)svc(?:\.cluster\.local)?$/);
    expect(hostname).not.toMatch(/(?:^|\.)cluster\.local$/);
  });

  it("generates browser runtime config from Vite environment variables", () => {
    const entrypoint = readFileSync(
      resolve(repoRoot, "apps/web/docker-entrypoint.sh"),
      "utf8",
    );

    expect(entrypoint).toContain("window.__NEXUS_FORM_CONFIG__");
    expect(entrypoint).toContain("VITE_API_URL");
    expect(entrypoint).toContain("VITE_HCAPTCHA_SITE_KEY");
    expect(entrypoint).toContain("VITE_FORM_SECURITY_DEV_BYPASS");
  });
});
