#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(scriptDir, "..");

const KUSTOMIZATION_TARGETS = [
  ["base", "k8s/base"],
  ["production", "k8s/overlays/production"],
];

function readRepositoryFile(repositoryRoot, relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function extractRequiredString(source, pattern, description) {
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not find ${description} in repository sources`);
  }
  return match[1];
}

function decodeYamlScalar(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  const lastIndex = trimmed.length - 1;

  if ((quote === '"' || quote === "'") && trimmed[lastIndex] === quote) {
    const innerValue = trimmed.slice(1, lastIndex);
    return quote === "'" ? innerValue.replaceAll("''", "'") : innerValue;
  }

  return trimmed;
}

export function extractFixedApiQueueNames(apiQueues) {
  const fixedApiQueues = [
    ...apiQueues.matchAll(/new Queue\("([^"$]+)"\s*,/g),
  ].map((match) => match[1]);

  if (fixedApiQueues.length === 0) {
    throw new Error(
      "Could not find fixed API queue constructors in apps/api/src/lib/queues.ts",
    );
  }

  return fixedApiQueues;
}

export function getFirstPartyQueueNames(repositoryRoot = rootDir) {
  const pluginBootstrap = readRepositoryFile(
    repositoryRoot,
    "packages/integrations/src/plugin-bootstrap.ts",
  );
  const validationQueues = [
    ...pluginBootstrap.matchAll(/validation-provider-([a-z0-9_]+)\/plugin/g),
  ].map((match) => `${match[1]}-validation`);

  if (validationQueues.length === 0) {
    throw new Error(
      "Could not find built-in validation providers in plugin-bootstrap.ts",
    );
  }

  const apiQueues = readRepositoryFile(
    repositoryRoot,
    "apps/api/src/lib/queues.ts",
  );
  const fixedApiQueues = extractFixedApiQueueNames(apiQueues);

  const sharedNotifications = readRepositoryFile(
    repositoryRoot,
    "packages/shared/src/validation/notifications.ts",
  );
  const notificationQueue = extractRequiredString(
    sharedNotifications,
    /export const FORM_SUBMIT_NOTIFICATION_QUEUE\s*=\s*"([^"]+)"/,
    "FORM_SUBMIT_NOTIFICATION_QUEUE",
  );

  return [
    ...new Set([...validationQueues, ...fixedApiQueues, notificationQueue]),
  ];
}

function parseConfigMapData(manifest, resourceName) {
  const document = manifest
    .split(/^---\s*$/m)
    .find(
      (candidate) =>
        /^kind:\s*ConfigMap\s*$/m.test(candidate) &&
        new RegExp(`^  name:\\s*${resourceName}$`, "m").test(candidate),
    );

  if (!document) {
    return null;
  }

  const dataStart = document.indexOf("data:\n");
  if (dataStart === -1) {
    return new Map();
  }
  const dataContentStart = dataStart + "data:\n".length;
  const dataEnd = document.indexOf("\nkind:", dataContentStart);
  const dataSection = document.slice(
    dataContentStart,
    dataEnd === -1 ? document.length : dataEnd,
  );

  return new Map(
    [
      ...dataSection.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/gm),
    ].map((match) => [match[1], decodeYamlScalar(match[2] ?? "")]),
  );
}

function extractWorkerQueues(manifest) {
  return new Set(
    [
      ...manifest.matchAll(
        /^[ \t]*- name: WORKER_QUEUES\r?\n(?:[ \t]*#.*\r?\n|[ \t]*\r?\n)*[ \t]*value:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gm,
      ),
    ]
      .flatMap((match) => (match[1] ?? match[2] ?? match[3]).split(","))
      .map((queueName) => queueName.trim())
      .filter(Boolean),
  );
}

export function checkRenderedManifest(manifest, { label, requiredQueueNames }) {
  const errors = [];
  const configMapData = parseConfigMapData(manifest, "nexus-form-config");
  const trustedOrigins = configMapData?.get("TRUSTED_ORIGINS")?.trim();

  if (!trustedOrigins) {
    errors.push("nexus-form-config.data.TRUSTED_ORIGINS is missing or empty");
  }

  const workerQueues = extractWorkerQueues(manifest);
  const missingQueues = requiredQueueNames.filter(
    (queueName) => !workerQueues.has(queueName),
  );
  if (missingQueues.length > 0) {
    errors.push(
      `first-party queues have no Kubernetes consumer: ${missingQueues.join(", ")}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `${label} Kubernetes runtime wiring check failed:\n- ${errors.join("\n- ")}`,
    );
  }

  return { trustedOrigins, workerQueues };
}

export function renderKustomization(repositoryRoot, relativePath) {
  const targetPath = resolve(repositoryRoot, relativePath);

  try {
    return execFileSync("kubectl", ["kustomize", targetPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const details =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : String(error);
    throw new Error(`kubectl kustomize ${relativePath} failed:\n${details}`);
  }
}

export function checkK8sRuntimeWiring(repositoryRoot = rootDir) {
  const requiredQueueNames = getFirstPartyQueueNames(repositoryRoot);

  return KUSTOMIZATION_TARGETS.map(([label, relativePath]) => {
    const manifest = renderKustomization(repositoryRoot, relativePath);
    return {
      label,
      ...checkRenderedManifest(manifest, { label, requiredQueueNames }),
    };
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const reports = checkK8sRuntimeWiring();
  console.log(
    `Kubernetes runtime wiring is valid for ${reports.map(({ label }) => label).join(" and ")}.`,
  );
}
