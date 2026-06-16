import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const vitestBin = join(webRoot, "node_modules", ".bin", "vitest");

function collectTestFiles(dir, out) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectTestFiles(path, out);
      continue;
    }
    if (/\.test\.(t|j)sx?$/.test(entry)) {
      out.push(path);
    }
  }
}

const files = [];
collectTestFiles(join(webRoot, "src"), files);
files.sort();

if (files.length === 0) {
  console.error("No test files found under src.");
  process.exit(1);
}

const extraArgs = process.argv.slice(2);

let failed = false;
for (const file of files) {
  const relative = file.slice(webRoot.length + 1);
  const result = spawnSync(vitestBin, ["run", relative, ...extraArgs], {
    cwd: webRoot,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Failed to spawn vitest: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
