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
  const secretName = manifest.match(/^\s*name:\s*(?<name>\S+)\s*$/m)?.groups
    ?.name;
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
