#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const passThroughArgs = process.argv.slice(2);
if (passThroughArgs[0] === "--") {
  passThroughArgs.shift();
}

const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", ...passThroughArgs],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
