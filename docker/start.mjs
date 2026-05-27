#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const TARGET_DIRS = (process.env.TARGET_DIRS ?? "apps/web/dist")
  .split(" ")
  .map((value) => value.trim())
  .filter(Boolean);
const EXCLUDE_PATTERNS = (process.env.EXCLUDE_PATTERNS ?? "*/node_modules/* */cache/*")
  .split(" ")
  .map((value) => value.trim())
  .filter(Boolean);

const shouldExclude = (path) => {
  const normalized = path.replaceAll("\\", "/");

  return EXCLUDE_PATTERNS.some((pattern) => {
    if (pattern === "*/node_modules/*") {
      return normalized.includes("/node_modules/");
    }

    if (pattern === "*/cache/*") {
      return normalized.includes("/cache/");
    }

    return normalized.includes(pattern.replace("*", ""));
  });
};

const walkFiles = async (directory, files = []) => {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (shouldExclude(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkFiles(fullPath, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

const replacements = Object.entries(process.env)
  .filter(([name]) => name.startsWith("VITE_") || name.startsWith("NEXT_PUBLIC_"))
  .map(([name, value]) => ({
    token: `_${name}_`,
    value,
  }));

const replaceEnvironment = async () => {
  const targetPaths = (
    await Promise.all(
      TARGET_DIRS.map((target) => {
        const targetPath = resolve(target);

        return stat(targetPath)
          .then(() => targetPath)
          .catch(() => null);
      }),
    )
  ).filter(Boolean);

  if (targetPaths.length === 0 || replacements.length === 0) {
    return;
  }

  for (const targetPath of targetPaths) {
    const files = await walkFiles(targetPath, []);

    for (const filePath of files) {
      let content;

      try {
        content = await readFile(filePath, "utf8");
      } catch {
        continue;
      }

      let next = content;

      for (const replacement of replacements) {
        if (next.includes(replacement.token)) {
          next = next.split(replacement.token).join(replacement.value);
        }
      }

      if (next !== content) {
        await writeFile(filePath, next, "utf8");
      }
    }
  }
};

const runNode = (args) => {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

(async () => {
  await replaceEnvironment();
  runNode(["/migration/run-migrations.mjs"]);
  runNode(["./apps/api/dist/index.mjs"]);
})();
