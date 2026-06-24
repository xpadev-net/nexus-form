import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  console.error(
    "Usage: node scripts/assert-no-test-artifacts.mjs <dist-dir> [...]",
  );
  process.exit(2);
}

const testModulePattern = /\.(?:test|spec)\.mjs(?:\.map)?$/;
const offenders = [];
const missingRoots = [];

const formatPath = (path) => relative(process.cwd(), path).split(sep).join("/");

const visit = (path) => {
  const name = basename(path);

  if (name === "__tests__" || testModulePattern.test(name)) {
    offenders.push(path);
    return;
  }

  const stats = lstatSync(path);

  if (stats.isDirectory()) {
    for (const child of readdirSync(path)) {
      visit(resolve(path, child));
    }
  }
};

for (const root of roots) {
  const resolvedRoot = resolve(root);

  if (!existsSync(resolvedRoot)) {
    missingRoots.push(resolvedRoot);
    continue;
  }

  visit(resolvedRoot);
}

if (missingRoots.length > 0) {
  console.error("Build artifact path does not exist:");

  for (const missingRoot of missingRoots.sort()) {
    console.error(` - ${formatPath(missingRoot)}`);
  }

  process.exit(1);
}

if (offenders.length > 0) {
  console.error("Production build contains test artifacts:");

  for (const offender of offenders.sort()) {
    console.error(` - ${formatPath(offender)}`);
  }

  process.exit(1);
}
