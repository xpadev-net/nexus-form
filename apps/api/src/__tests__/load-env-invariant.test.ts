import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");

describe("entrypoint env loading", () => {
  it.each([
    "apps/api/src/load-env.ts",
    "apps/worker/src/load-env.ts",
  ])("%s does not suspend before dotenv config runs", (relativePath) => {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");

    expect(source).toContain("createRequire");
    expect(source).not.toContain('await import("dotenv")');
  });
});
