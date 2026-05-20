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

function readConfigMapValue(key: string): string {
  const value = configMapManifest.match(
    new RegExp(`^\\s{2}${key}:\\s*"(?<value>[^"]*)"\\s*$`, "m"),
  )?.groups?.value;
  if (value === undefined) {
    throw new Error(`Missing ${key} in configmap.yaml`);
  }
  return value;
}

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
});

describe("k8s web runtime configuration", () => {
  it("injects the ConfigMap into the web Deployment", () => {
    expect(readDeploymentConfigMapRefs("web-deployment.yaml")).toContain(
      "nexus-form-config",
    );
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
  });
});
