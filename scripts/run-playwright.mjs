#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const passThroughArgs = process.argv.slice(2);
if (passThroughArgs[0] === "--") {
  passThroughArgs.shift();
}

const ciMode = passThroughArgs[0] === "--ci";

if (!ciMode) {
  process.exit(runPlaywright(passThroughArgs));
}

passThroughArgs.shift();
if (passThroughArgs[0] === "--") {
  passThroughArgs.shift();
}

const inventoryOnly =
  passThroughArgs.length === 1 && passThroughArgs[0] === "--list";
if (passThroughArgs.length > 0 && !inventoryOnly) {
  console.error(
    "CI Playwright mode only accepts --list; its test selector is intentionally fixed.",
  );
  process.exit(1);
}

const ciSelectorArgs = [
  "e2e/accessibility.spec.ts",
  "e2e/share-links.spec.ts",
  "--grep-invert",
  "ランドマーク|見出し構造",
];
const expectedCiCountByFile = new Map([
  ["accessibility.spec.ts", 10],
  ["share-links.spec.ts", 4],
]);
const requiredCriticalCategories = new Map([
  ["ci-shared-link", 2],
  ["ci-realtime", 1],
  ["ci-external-validation", 1],
]);
const inventoryTimeoutMs = 120_000;
const inventoryMaxBufferBytes = 16 * 1024 * 1024;

try {
  const fullInventory = discoverTests("full suite", []);
  const ciInventory = discoverTests("CI selector", ciSelectorArgs);

  printInventory("full suite", fullInventory);
  printInventory("CI selector", ciInventory);
  validateCiInventory(fullInventory, ciInventory);

  console.log(
    `[playwright inventory] selector validated: ${JSON.stringify(ciSelectorArgs)}`,
  );

  if (inventoryOnly) {
    console.log("[playwright inventory] --list requested; tests were not run.");
    process.exit(0);
  }

  runCiPlaywright(ciInventory, ciSelectorArgs);
  process.exit(0);
} catch (error) {
  console.error(
    `[playwright inventory] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

function runPlaywright(args) {
  const result = spawnSync("pnpm", ["exec", "playwright", "test", ...args], {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

function runCiPlaywright(ciInventory, args) {
  const reportDirectory = mkdtempSync(
    join(tmpdir(), "nexus-form-playwright-report-"),
  );
  const reportPath = join(reportDirectory, "results.json");

  try {
    const result = spawnSync(
      "pnpm",
      ["exec", "playwright", "test", ...args, "--reporter=github,json"],
      {
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
        shell: process.platform === "win32",
        stdio: "inherit",
      },
    );

    if (result.error) {
      throw new Error(`CI Playwright run failed: ${result.error.message}`);
    }

    const runReport = parseJsonReport(
      "CI run",
      readFileSync(reportPath, "utf8"),
    );
    const runErrors = parseDiscoveryErrors("CI run", runReport);
    if (result.status !== 0 || runErrors.length > 0) {
      throw new Error(
        `CI Playwright run exited with status ${result.status ?? "unknown"}${
          runErrors.length ? `:\n${runErrors.join("\n")}` : ""
        }`,
      );
    }

    const runInventory = flattenReport("CI run", runReport);
    const stats = readRunStats(runReport);
    validateCiRun(ciInventory, runInventory, stats);
    console.log(
      `[playwright result] validated: expected=${stats.expected} skipped=${stats.skipped} unexpected=${stats.unexpected} flaky=${stats.flaky}`,
    );
  } finally {
    rmSync(reportDirectory, { force: true, recursive: true });
  }
}

function discoverTests(label, selectorArgs) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--list",
      "--reporter=json",
      ...selectorArgs,
    ],
    {
      encoding: "utf8",
      maxBuffer: inventoryMaxBufferBytes,
      shell: process.platform === "win32",
      timeout: inventoryTimeoutMs,
    },
  );

  if (result.error) {
    throw new Error(`${label} discovery failed: ${result.error.message}`);
  }

  const report = parseJsonReport(label, result.stdout);
  const discoveryErrors = parseDiscoveryErrors(label, report);
  if (result.status !== 0 || discoveryErrors.length > 0) {
    const details = discoveryErrors.length
      ? discoveryErrors.join("\n")
      : outputExcerpt(result.stderr);
    throw new Error(
      `${label} discovery exited with status ${result.status ?? "unknown"}${
        details ? `:\n${details}` : ""
      }`,
    );
  }

  if (result.stderr.trim()) {
    console.warn(
      `[playwright inventory] ${label} discovery stderr:\n${outputExcerpt(result.stderr)}`,
    );
  }

  return flattenReport(label, report);
}

function parseJsonReport(label, stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${label} discovery returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }${stdout ? `\n${outputExcerpt(stdout)}` : "\nstdout was empty"}`,
    );
  }

  if (!isRecord(report)) {
    throw new Error(`${label} discovery JSON must be an object.`);
  }
  if (!Array.isArray(report.suites)) {
    throw new Error(`${label} discovery JSON is missing suites[].`);
  }
  if (!Array.isArray(report.errors)) {
    throw new Error(`${label} discovery JSON is missing errors[].`);
  }

  return report;
}

function parseDiscoveryErrors(label, report) {
  return report.errors.map((error, index) => {
    if (!isRecord(error) || typeof error.message !== "string") {
      throw new Error(
        `${label} discovery JSON has an invalid errors[${index}] entry.`,
      );
    }
    return error.message;
  });
}

function flattenReport(label, report) {
  const entries = [];

  for (const [suiteIndex, suite] of report.suites.entries()) {
    visitSuite(label, suite, `suites[${suiteIndex}]`, [], entries);
  }

  if (entries.length === 0) {
    throw new Error(`${label} discovery returned no tests.`);
  }

  const identities = new Set();
  for (const entry of entries) {
    if (identities.has(entry.identity)) {
      throw new Error(
        `${label} discovery returned duplicate test identity ${entry.identity}.`,
      );
    }
    identities.add(entry.identity);
  }

  return entries;
}

function visitSuite(label, suite, jsonPath, parentTitles, entries) {
  if (!isRecord(suite)) {
    throw new Error(`${label} discovery JSON has an invalid ${jsonPath}.`);
  }

  const title = readString(label, suite.title, `${jsonPath}.title`);
  const titles = title ? [...parentTitles, title] : parentTitles;
  const specs = readOptionalArray(label, suite.specs, `${jsonPath}.specs`);
  const childSuites = readOptionalArray(
    label,
    suite.suites,
    `${jsonPath}.suites`,
  );

  for (const [specIndex, spec] of specs.entries()) {
    const specPath = `${jsonPath}.specs[${specIndex}]`;
    if (!isRecord(spec)) {
      throw new Error(`${label} discovery JSON has an invalid ${specPath}.`);
    }

    const id = readString(label, spec.id, `${specPath}.id`);
    const file = readString(label, spec.file, `${specPath}.file`);
    const line = readNumber(label, spec.line, `${specPath}.line`);
    const specTitle = readString(label, spec.title, `${specPath}.title`);
    const tags = readStringArray(label, spec.tags, `${specPath}.tags`).map(
      normalizeTag,
    );
    if (new Set(tags).size !== tags.length) {
      throw new Error(
        `${label} discovery JSON has duplicate tags in ${specPath}.`,
      );
    }

    const tests = readArray(label, spec.tests, `${specPath}.tests`);
    if (tests.length === 0) {
      throw new Error(`${label} discovery JSON has no tests in ${specPath}.`);
    }

    for (const [testIndex, test] of tests.entries()) {
      const testPath = `${specPath}.tests[${testIndex}]`;
      if (!isRecord(test)) {
        throw new Error(`${label} discovery JSON has an invalid ${testPath}.`);
      }

      const projectId = readString(
        label,
        test.projectId,
        `${testPath}.projectId`,
      );
      const projectName = readString(
        label,
        test.projectName,
        `${testPath}.projectName`,
      );
      const expectedStatus = readString(
        label,
        test.expectedStatus,
        `${testPath}.expectedStatus`,
      );
      const annotations = readAnnotations(
        label,
        test.annotations,
        `${testPath}.annotations`,
      );

      entries.push({
        annotations,
        executed:
          readArray(label, test.results, `${testPath}.results`).length > 0,
        expectedStatus,
        file,
        identity: `${id}:${projectId}`,
        line,
        outcome: readOptionalString(label, test.status, `${testPath}.status`),
        projectName,
        tags,
        title: [...titles, specTitle].join(" > "),
      });
    }
  }

  for (const [suiteIndex, childSuite] of childSuites.entries()) {
    visitSuite(
      label,
      childSuite,
      `${jsonPath}.suites[${suiteIndex}]`,
      titles,
      entries,
    );
  }
}

function validateCiInventory(fullInventory, ciInventory) {
  if (ciInventory.length !== 14) {
    throw new Error(
      `CI selector drifted: expected 14 tests, discovered ${ciInventory.length}.`,
    );
  }

  const ciCountByFile = countBy(ciInventory, (entry) => entry.file);
  assertExactCounts("CI file", ciCountByFile, expectedCiCountByFile);

  const invalidCiTests = ciInventory.filter(
    (entry) => entry.expectedStatus !== "passed" || isFixmeOrSkipped(entry),
  );
  if (invalidCiTests.length > 0) {
    throw new Error(
      `CI selector contains non-runnable or non-passed tests:\n${invalidCiTests
        .map(formatEntry)
        .join("\n")}`,
    );
  }

  const excludedAccessibilityTitle = /ランドマーク|見出し構造/;
  const fullAccessibility = fullInventory.filter(
    (entry) => entry.file === "accessibility.spec.ts",
  );
  const expectedAccessibility = fullAccessibility.filter(
    (entry) => !excludedAccessibilityTitle.test(entry.title),
  );
  const excludedAccessibility = fullAccessibility.filter((entry) =>
    excludedAccessibilityTitle.test(entry.title),
  );
  if (
    fullAccessibility.length !== 12 ||
    expectedAccessibility.length !== 10 ||
    excludedAccessibility.length !== 2
  ) {
    throw new Error(
      `accessibility inventory drifted: expected 12 total / 10 selected / 2 excluded, discovered ${fullAccessibility.length} / ${expectedAccessibility.length} / ${excludedAccessibility.length}.`,
    );
  }

  const fullShareLinks = fullInventory.filter(
    (entry) => entry.file === "share-links.spec.ts",
  );
  if (fullShareLinks.length !== 4) {
    throw new Error(
      `share-links inventory drifted: expected 4 tests, discovered ${fullShareLinks.length}.`,
    );
  }

  assertSameTests("accessibility selector", expectedAccessibility, ciInventory);
  assertSameTests("share-links selector", fullShareLinks, ciInventory);

  const fullCritical = validateCriticalTags("full suite", fullInventory);
  const ciCritical = validateCriticalTags("CI selector", ciInventory);
  assertSameIdentities("critical selector", fullCritical, ciCritical);

  const ciCriticalOutsideShareLinks = ciCritical.filter(
    (entry) => entry.file !== "share-links.spec.ts",
  );
  if (ciCriticalOutsideShareLinks.length > 0) {
    throw new Error(
      `@ci-critical tests must be in share-links.spec.ts:\n${ciCriticalOutsideShareLinks
        .map(formatEntry)
        .join("\n")}`,
    );
  }
}

function validateCiRun(ciInventory, runInventory, stats) {
  assertSameIdentities("CI run", ciInventory, runInventory);

  const invalidOutcomes = runInventory.filter(
    (entry) =>
      !entry.executed ||
      entry.outcome !== "expected" ||
      entry.expectedStatus !== "passed" ||
      isFixmeOrSkipped(entry),
  );
  if (invalidOutcomes.length > 0) {
    throw new Error(
      `CI run contains skipped, flaky, or otherwise non-passing tests:\n${invalidOutcomes
        .map(formatEntry)
        .join("\n")}`,
    );
  }

  const expectedStats = {
    expected: ciInventory.length,
    flaky: 0,
    skipped: 0,
    unexpected: 0,
  };
  const mismatchedStats = Object.entries(expectedStats).filter(
    ([key, expected]) => stats[key] !== expected,
  );
  if (mismatchedStats.length > 0) {
    throw new Error(
      `CI run result counts drifted: expected ${JSON.stringify(expectedStats)}, discovered ${JSON.stringify(stats)}.`,
    );
  }
}

function readRunStats(report) {
  if (!isRecord(report.stats)) {
    throw new Error("CI run JSON is missing stats.");
  }

  return Object.fromEntries(
    ["expected", "flaky", "skipped", "unexpected"].map((key) => {
      const value = readNumber("CI run", report.stats[key], `stats.${key}`);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`CI run JSON has invalid stats.${key}.`);
      }
      return [key, value];
    }),
  );
}

function validateCriticalTags(label, inventory) {
  const categoryTags = new Set(requiredCriticalCategories.keys());
  const critical = inventory.filter((entry) =>
    entry.tags.includes("ci-critical"),
  );

  if (critical.length !== 4) {
    throw new Error(
      `${label} must contain exactly 4 @ci-critical tests; discovered ${critical.length}.`,
    );
  }

  const orphanedCategories = inventory.filter(
    (entry) =>
      !entry.tags.includes("ci-critical") &&
      entry.tags.some((tag) => categoryTags.has(tag)),
  );
  if (orphanedCategories.length > 0) {
    throw new Error(
      `${label} contains CI category tags without @ci-critical:\n${orphanedCategories
        .map(formatEntry)
        .join("\n")}`,
    );
  }

  for (const entry of critical) {
    const entryCategories = entry.tags.filter((tag) => categoryTags.has(tag));
    if (entryCategories.length !== 1) {
      throw new Error(
        `${formatEntry(entry)} must have exactly one CI category tag; found ${entryCategories.length}.`,
      );
    }
    if (entry.expectedStatus !== "passed" || isFixmeOrSkipped(entry)) {
      throw new Error(`${formatEntry(entry)} must have expectedStatus=passed.`);
    }
  }

  const categoryCounts = countBy(critical, (entry) =>
    entry.tags.find((tag) => categoryTags.has(tag)),
  );
  assertExactCounts(
    `${label} critical category`,
    categoryCounts,
    requiredCriticalCategories,
  );

  return critical;
}

function assertSameTests(label, expected, actualInventory) {
  const actualIdentities = new Set(
    actualInventory.map((entry) => entry.identity),
  );
  const missing = expected.filter(
    (entry) => !actualIdentities.has(entry.identity),
  );
  if (missing.length > 0) {
    throw new Error(
      `${label} omitted expected tests:\n${missing.map(formatEntry).join("\n")}`,
    );
  }
}

function assertSameIdentities(label, expected, actual) {
  const expectedIdentities = new Set(expected.map((entry) => entry.identity));
  const actualIdentities = new Set(actual.map((entry) => entry.identity));
  const missing = expected.filter(
    (entry) => !actualIdentities.has(entry.identity),
  );
  const unexpected = actual.filter(
    (entry) => !expectedIdentities.has(entry.identity),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} drifted:${
        missing.length
          ? `\nmissing:\n${missing.map(formatEntry).join("\n")}`
          : ""
      }${
        unexpected.length
          ? `\nunexpected:\n${unexpected.map(formatEntry).join("\n")}`
          : ""
      }`,
    );
  }
}

function assertExactCounts(label, actual, expected) {
  const actualKeys = new Set(actual.keys());
  const unexpectedKeys = [...actualKeys].filter((key) => !expected.has(key));
  const mismatches = [...expected.entries()].filter(
    ([key, count]) => actual.get(key) !== count,
  );
  if (unexpectedKeys.length === 0 && mismatches.length === 0) {
    return;
  }

  throw new Error(
    `${label} counts drifted: expected ${formatCounts(expected)}, discovered ${formatCounts(actual)}.`,
  );
}

function countBy(entries, selectKey) {
  const counts = new Map();
  for (const entry of entries) {
    const key = selectKey(entry);
    if (typeof key !== "string") {
      throw new Error("Inventory count key was missing.");
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function printInventory(label, inventory) {
  const fixmeOrSkipped = inventory.filter(isFixmeOrSkipped);
  const runnable = inventory.filter((entry) => !isFixmeOrSkipped(entry));

  console.log(
    `[playwright inventory] ${label}: total=${inventory.length} runnable=${runnable.length} fixme/skipped=${fixmeOrSkipped.length}`,
  );
  printInventoryGroup(`${label} runnable`, runnable, "RUN");
  printInventoryGroup(`${label} fixme/skipped`, fixmeOrSkipped, "FIXME/SKIP");
}

function printInventoryGroup(label, entries, disposition) {
  console.log(`[playwright inventory] ${label} (${entries.length})`);
  for (const entry of entries) {
    console.log(`  ${disposition} ${formatEntry(entry)}`);
  }
}

function formatEntry(entry) {
  const tags = entry.tags.map((tag) => `@${tag}`).join(" ");
  const annotations = entry.annotations.length
    ? ` annotations=${entry.annotations.join(",")}`
    : "";
  const outcome =
    entry.executed && entry.outcome ? ` outcome=${entry.outcome}` : "";
  return `[${entry.projectName}] ${entry.file}:${entry.line} ${entry.title} expectedStatus=${entry.expectedStatus}${outcome}${
    tags ? ` tags=${tags}` : ""
  }${annotations}`;
}

function formatCounts(counts) {
  return [...counts.entries()]
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function isFixmeOrSkipped(entry) {
  return (
    entry.expectedStatus === "skipped" ||
    entry.annotations.some(
      (annotation) => annotation === "fixme" || annotation === "skip",
    )
  );
}

function normalizeTag(tag) {
  return tag.startsWith("@") ? tag.slice(1) : tag;
}

function readAnnotations(label, value, jsonPath) {
  const annotations = readArray(label, value, jsonPath);
  return annotations.map((annotation, index) => {
    if (!isRecord(annotation) || typeof annotation.type !== "string") {
      throw new Error(
        `${label} discovery JSON has an invalid ${jsonPath}[${index}].`,
      );
    }
    return annotation.type;
  });
}

function readStringArray(label, value, jsonPath) {
  const values = readArray(label, value, jsonPath);
  return values.map((item, index) =>
    readString(label, item, `${jsonPath}[${index}]`),
  );
}

function readArray(label, value, jsonPath) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} discovery JSON is missing ${jsonPath}[].`);
  }
  return value;
}

function readOptionalArray(label, value, jsonPath) {
  if (value === undefined) return [];
  return readArray(label, value, jsonPath);
}

function readString(label, value, jsonPath) {
  if (typeof value !== "string") {
    throw new Error(`${label} discovery JSON has invalid ${jsonPath}.`);
  }
  return value;
}

function readOptionalString(label, value, jsonPath) {
  if (value === undefined) return null;
  return readString(label, value, jsonPath);
}

function readNumber(label, value, jsonPath) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} discovery JSON has invalid ${jsonPath}.`);
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outputExcerpt(output) {
  const maximumLength = 4_000;
  return output.length > maximumLength
    ? `...${output.slice(-maximumLength)}`
    : output;
}
