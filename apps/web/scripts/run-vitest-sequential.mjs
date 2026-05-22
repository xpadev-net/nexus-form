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

let failed = false;
for (const file of files) {
  const relative = file.slice(webRoot.length + 1);
  const result = spawnSync(vitestBin, ["run", relative], {
    cwd: webRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
