import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");

describe("entrypoint env loading", () => {
  it.each([
    "apps/api/src/load-env.ts",
    "apps/worker/src/load-env.ts",
  ])("%s delegates to the shared synchronous loader", (relativePath) => {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");

    expect(source).toContain("loadEnvFileSync");
    expect(source).toContain("moduleUrl: import.meta.url");
    expect(source).not.toMatch(/await\s+import\(["']dotenv["']\)/);
  });

  it("shared env loader does not suspend before dotenv config runs", () => {
    const source = readFileSync(
      resolve(repoRoot, "packages/shared/src/node/load-env.ts"),
      "utf8",
    );

    expect(source).toContain("createRequire");
    expect(source).not.toContain("await ");
    expect(source).not.toMatch(/import\(["']dotenv["']\)/);
  });
});
