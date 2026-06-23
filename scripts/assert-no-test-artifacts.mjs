import { readdirSync, statSync } from "node:fs";
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

const formatPath = (path) => relative(process.cwd(), path).split(sep).join("/");

const visit = (path) => {
  const stats = statSync(path);

  if (stats.isDirectory()) {
    if (basename(path) === "__tests__") {
      offenders.push(path);
      return;
    }

    for (const child of readdirSync(path)) {
      visit(resolve(path, child));
    }

    return;
  }

  if (stats.isFile() && testModulePattern.test(basename(path))) {
    offenders.push(path);
  }
};

for (const root of roots) {
  visit(resolve(root));
}

if (offenders.length > 0) {
  console.error("Production build contains test artifacts:");

  for (const offender of offenders.sort()) {
    console.error(` - ${formatPath(offender)}`);
  }

  process.exit(1);
}
