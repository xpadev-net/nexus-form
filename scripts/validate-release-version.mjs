#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseTypes = new Set(["major", "minor", "patch"]);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function getOptionValue(args, optionName) {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) return null;

  const value = args[optionIndex + 1];
  if (!value || value.startsWith("--")) {
    fail(`${optionName} requires a value`);
  }

  return value;
}

function getPositionalArgs(args) {
  const positionalArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--release-type" || arg === "--github-output") {
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(`unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

function getReleaseType(args) {
  const explicitReleaseType = getOptionValue(args, "--release-type");
  const positionalArgs = getPositionalArgs(args);
  if (positionalArgs.length > 1) {
    fail("expected at most one release type argument");
  }

  if (explicitReleaseType && positionalArgs.length > 0) {
    fail("release type must be provided only once");
  }

  return explicitReleaseType ?? positionalArgs[0] ?? process.env.RELEASE_TYPE ?? "patch";
}

function parseVersion(version, sourceName) {
  if (typeof version !== "string") {
    fail(`${sourceName} must be a string`);
  }

  const match = semverPattern.exec(version);
  if (!match) {
    fail(`${sourceName} must be a stable semver version like 1.2.3`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

const args = process.argv.slice(2);
const releaseType = getReleaseType(args);
if (!releaseTypes.has(releaseType)) {
  fail(`release type must be one of: ${Array.from(releaseTypes).join(", ")}`);
}

const packageJsonPath = resolve("package.json");
let packageJson;
try {
  packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`package.json must be readable JSON: ${message}`);
}

const currentVersion = packageJson.version;
const parsedVersion = parseVersion(currentVersion, "package.json version");

const nextVersion = {
  major: `${parsedVersion.major + 1}.0.0`,
  minor: `${parsedVersion.major}.${parsedVersion.minor + 1}.0`,
  patch: `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch + 1}`,
}[releaseType];

parseVersion(nextVersion, "calculated release version");

console.log(`Release version source of truth: ${packageJsonPath}`);
console.log(`Current version: ${currentVersion}`);
console.log(`Release type: ${releaseType}`);
console.log(`New version: ${nextVersion}`);

const githubOutputPath = getOptionValue(args, "--github-output");
if (githubOutputPath) {
  try {
    appendFileSync(
      githubOutputPath,
      `current_version=${currentVersion}\nnew_version=${nextVersion}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`failed to write GitHub output: ${message}`);
  }
}
