#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  checkContainerRuntimeWiring,
  checkContainerRuntimeWiringSources,
  rootDir,
} from "./check-container-runtime-wiring.mjs";

const readFixture = (relativePath) =>
  readFileSync(resolve(rootDir, relativePath), "utf8");

const loadSources = () => ({
  dockerfile: readFixture("Dockerfile"),
  startScript: readFixture("docker/start.mjs"),
  migrationScript: readFixture("scripts/run-migrations.mjs"),
  migrationJob: readFixture("k8s/base/api-migration-job.yaml"),
});

test("production container wiring preserves the migration and API startup boundary", () => {
  assert.deepEqual(checkContainerRuntimeWiring(rootDir), {
    databasePackagePath: "/migration/node_modules/@nexus-form/database",
    migrationOwner: "dedicated-job",
  });
});

test("fails when the database deploy closure is absent from the migration resolution path", () => {
  const sources = loadSources();
  sources.dockerfile = sources.dockerfile.replace(
    /^COPY --from=builder \/tmp\/db-deploy .*\r?\n/m,
    "",
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /complete database production deploy closure is not installed/,
  );
});

test("fails when fragmented copies replace the database deploy closure", () => {
  const sources = loadSources();
  sources.dockerfile = sources.dockerfile.replace(
    /^COPY --from=builder \/tmp\/db-deploy .*$/m,
    [
      "COPY --from=builder /tmp/db-deploy/node_modules /migration/node_modules",
      "COPY --from=builder /tmp/db-deploy/package.json /migration/node_modules/@nexus-form/database/package.json",
      "COPY --from=builder /tmp/db-deploy/dist /migration/node_modules/@nexus-form/database/dist",
    ].join("\n"),
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /fragmented database deploy COPY instructions must not replace/,
  );
});

test("fails when the migration runner imports the side-effectful database package root", () => {
  const sources = loadSources();
  sources.migrationScript = sources.migrationScript.replace(
    'from "@nexus-form/database/migrate"',
    'from "@nexus-form/database"',
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /must not import the side-effectful @nexus-form\/database package root/,
  );
});

test("fails when the migration runner bypasses the dedicated migrate entrypoint", () => {
  const sources = loadSources();
  sources.migrationScript = sources.migrationScript.replace(
    'from "@nexus-form/database/migrate"',
    'from "../packages/database/dist/migrate.js"',
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /must use the dedicated @nexus-form\/database\/migrate entrypoint/,
  );
});

test("fails when API startup executes the migration runner", () => {
  const sources = loadSources();
  sources.startScript = sources.startScript.replace(
    "await replaceEnvironment();",
    'await replaceEnvironment();\n  await runNode(["/migration/run-migrations.mjs"]);',
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /API startup script must not execute migrations/,
  );
});

test("fails when the dedicated migration Job no longer runs migrations", () => {
  const sources = loadSources();
  sources.migrationJob = sources.migrationJob.replace(
    "        - /migration/run-migrations.mjs",
    "        - /app/start.mjs",
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /dedicated migration Job does not execute/,
  );
});

test("fails when API startup stops replacing environment values", () => {
  const sources = loadSources();
  sources.startScript = sources.startScript.replace(
    "await replaceEnvironment();",
    "",
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /replace environment values before starting the API/,
  );
});

test("fails when API startup stops forwarding termination signals", () => {
  const sources = loadSources();
  sources.startScript = sources.startScript.replace(
    'process.once("SIGTERM", handleSignal);',
    "",
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /does not forward SIGTERM/,
  );
});

test("fails when API startup stops propagating the API exit status", () => {
  const sources = loadSources();
  sources.startScript = sources.startScript.replace(
    "process.exit(apiStatus);",
    "process.exit(0);",
  );

  assert.throws(
    () => checkContainerRuntimeWiringSources(sources),
    /must propagate the API process exit status/,
  );
});
