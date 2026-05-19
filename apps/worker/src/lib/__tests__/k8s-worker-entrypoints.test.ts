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

  it("defines the Google OAuth encryption key required by worker startup", () => {
    expect(readManifest("secret.yaml")).toContain("GOOGLE_OAUTH_ENC_KEY:");
  });
});
