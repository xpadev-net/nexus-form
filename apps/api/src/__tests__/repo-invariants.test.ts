import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("repo invariants", () => {
  it("keeps a root .dockerignore that excludes local env files", () => {
    const dockerignorePath = resolve(process.cwd(), "../../.dockerignore");
    const contents = readFileSync(dockerignorePath, "utf8");
    expect(contents).toContain(".env*");
    expect(contents).toContain("node_modules");
  });
});
