#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(scriptDir, "..");

function readRepositoryFile(repositoryRoot, relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function requirePattern(errors, source, pattern, message) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

export function checkContainerRuntimeWiringSources({
  dockerfile,
  startScript,
  migrationScript,
  migrationJob,
}) {
  const errors = [];

  requirePattern(
    errors,
    dockerfile,
    /^COPY --from=builder \/tmp\/db-deploy \/migration\/node_modules\/@nexus-form\/database\s*$/m,
    "the complete database production deploy closure is not installed at the migration ESM resolution path",
  );
  if (
    /^COPY --from=builder \/tmp\/db-deploy\/(?:node_modules|package\.json|dist)(?:\/\S*)?\s+\/migration\//m.test(
      dockerfile,
    )
  ) {
    errors.push(
      "fragmented database deploy COPY instructions must not replace the complete production closure",
    );
  }
  requirePattern(
    errors,
    dockerfile,
    /^COPY \.\/scripts\/run-migrations\.mjs \/migration\/run-migrations\.mjs\s*$/m,
    "the standalone migration runner is not copied into the production image",
  );
  requirePattern(
    errors,
    migrationScript,
    /from\s+["']@nexus-form\/database["']/,
    "the migration runner must use the @nexus-form/database public bare import",
  );

  if (
    /runStartupMigrations|DRIZZLE_MIGRATIONS_DIR|\/migration\/run-migrations\.mjs/.test(
      startScript,
    )
  ) {
    errors.push(
      "the API startup script must not execute migrations; the dedicated Job owns them",
    );
  }

  const replaceEnvironmentIndex = startScript.indexOf(
    "await replaceEnvironment();",
  );
  const startApiIndex = startScript.indexOf(
    'const apiStatus = await runNode(["./apps/api/dist/index.mjs"]);',
  );
  const propagateStatusIndex = startScript.indexOf("process.exit(apiStatus);");

  if (
    replaceEnvironmentIndex === -1 ||
    startApiIndex === -1 ||
    replaceEnvironmentIndex > startApiIndex
  ) {
    errors.push(
      "the API startup script must replace environment values before starting the API",
    );
  }
  if (propagateStatusIndex === -1 || propagateStatusIndex < startApiIndex) {
    errors.push(
      "the API startup script must propagate the API process exit status",
    );
  }

  requirePattern(
    errors,
    startScript,
    /process\.once\(["']SIGINT["'],\s*handleSignal\)/,
    "the API startup script does not forward SIGINT",
  );
  requirePattern(
    errors,
    startScript,
    /process\.once\(["']SIGTERM["'],\s*handleSignal\)/,
    "the API startup script does not forward SIGTERM",
  );
  requirePattern(
    errors,
    startScript,
    /child\.kill\(signal\)/,
    "the API startup script does not forward received signals to the API process",
  );

  requirePattern(
    errors,
    migrationJob,
    /^\s*- \/migration\/run-migrations\.mjs\s*$/m,
    "the dedicated migration Job does not execute the standalone migration runner",
  );

  if (errors.length > 0) {
    throw new Error(
      `Container runtime wiring check failed:\n- ${errors.join("\n- ")}`,
    );
  }

  return {
    databasePackagePath: "/migration/node_modules/@nexus-form/database",
    migrationOwner: "dedicated-job",
  };
}

export function checkContainerRuntimeWiring(repositoryRoot = rootDir) {
  return checkContainerRuntimeWiringSources({
    dockerfile: readRepositoryFile(repositoryRoot, "Dockerfile"),
    startScript: readRepositoryFile(repositoryRoot, "docker/start.mjs"),
    migrationScript: readRepositoryFile(
      repositoryRoot,
      "scripts/run-migrations.mjs",
    ),
    migrationJob: readRepositoryFile(
      repositoryRoot,
      "k8s/base/api-migration-job.yaml",
    ),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = checkContainerRuntimeWiring();
  console.log(
    `Container runtime wiring is valid: ${report.databasePackagePath}, migrations owned by ${report.migrationOwner}.`,
  );
}
