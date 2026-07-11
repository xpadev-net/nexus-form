#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkK8sRuntimeWiring,
  checkRenderedManifest,
  extractFixedApiQueueNames,
  getFirstPartyQueueNames,
  renderKustomization,
  rootDir,
} from "./check-k8s-runtime-wiring.mjs";

test("base and production rendered manifests cover runtime wiring", () => {
  const reports = checkK8sRuntimeWiring(rootDir);
  const requiredQueueNames = getFirstPartyQueueNames(rootDir);

  assert.deepEqual(
    reports.map(({ label }) => label),
    ["base", "production"],
  );
  for (const report of reports) {
    assert.ok(report.trustedOrigins);
    for (const queueName of requiredQueueNames) {
      assert.ok(
        report.workerQueues.has(queueName),
        `${report.label}: ${queueName}`,
      );
    }
  }
});

test("fails closed when fixed API queue extraction finds no constructors", () => {
  assert.throws(
    () => extractFixedApiQueueNames("new Queue(FIXED_QUEUE, { connection })"),
    /Could not find fixed API queue constructors/,
  );
});

test("fails when TRUSTED_ORIGINS disappears from a rendered manifest", () => {
  const manifest = renderKustomization(rootDir, "k8s/overlays/production");
  const withoutTrustedOrigins = manifest.replace(
    /^ {2}TRUSTED_ORIGINS:.*\r?\n/m,
    "",
  );

  assert.notEqual(withoutTrustedOrigins, manifest);
  assert.throws(
    () =>
      checkRenderedManifest(withoutTrustedOrigins, {
        label: "production fixture",
        requiredQueueNames: getFirstPartyQueueNames(rootDir),
      }),
    /TRUSTED_ORIGINS is missing or empty/,
  );
});

for (const quote of ['"', "'"]) {
  test(`fails when TRUSTED_ORIGINS is an empty ${quote}-quoted scalar`, () => {
    const manifest = renderKustomization(rootDir, "k8s/overlays/production");
    const withQuotedEmptyOrigins = manifest.replace(
      /^ {2}TRUSTED_ORIGINS:.*$/m,
      `  TRUSTED_ORIGINS: ${quote}${quote}`,
    );

    assert.notEqual(withQuotedEmptyOrigins, manifest);
    assert.throws(
      () =>
        checkRenderedManifest(withQuotedEmptyOrigins, {
          label: `production ${quote}-quoted-empty fixture`,
          requiredQueueNames: getFirstPartyQueueNames(rootDir),
        }),
      /TRUSTED_ORIGINS is missing or empty/,
    );
  });
}

test("fails when a first-party queue has no Kubernetes consumer", () => {
  const manifest = renderKustomization(rootDir, "k8s/base");
  const withoutSheetsConsumer = manifest.replace(
    /^[ \t]*- name: WORKER_QUEUES\r?\n[ \t]*value: google-sheets-sync\r?\n/m,
    "",
  );

  assert.notEqual(withoutSheetsConsumer, manifest);
  assert.throws(
    () =>
      checkRenderedManifest(withoutSheetsConsumer, {
        label: "base fixture",
        requiredQueueNames: getFirstPartyQueueNames(rootDir),
      }),
    /google-sheets-sync/,
  );
});

test("accepts comments between WORKER_QUEUES and its literal value", () => {
  const manifest = renderKustomization(rootDir, "k8s/base");
  const withComment = manifest.replace(
    /(^[ \t]*- name: WORKER_QUEUES\r?\n)([ \t]*value: google-sheets-sync\r?\n)/m,
    "$1        # queue selection remains explicit\n$2",
  );

  assert.notEqual(withComment, manifest);
  assert.doesNotThrow(() =>
    checkRenderedManifest(withComment, {
      label: "base fixture",
      requiredQueueNames: getFirstPartyQueueNames(rootDir),
    }),
  );
});
