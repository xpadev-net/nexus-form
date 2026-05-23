import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const parseTscShowConfig = (output: string) => {
  const jsonStart = output.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("tsc --showConfig did not emit JSON");
  }

  return JSON.parse(output.slice(jsonStart)) as {
    compilerOptions: { paths: Record<string, string[]> };
  };
};

describe("root tsconfig path aliases", () => {
  it("maps @nexus-form/shared to the shared package source entry", () => {
    const raw = readFileSync(resolve(repoRoot, "tsconfig.json"), "utf8")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const config = JSON.parse(raw) as {
      compilerOptions: { paths: Record<string, string[]> };
    };

    expect(config.compilerOptions.paths["@nexus-form/shared"]).toEqual([
      "./packages/shared/src/index.ts",
    ]);
  });

  it("is inherited by workspace packages that extend the root tsconfig", () => {
    const output = execFileSync(
      "pnpm",
      ["exec", "tsc", "--showConfig", "-p", "packages/shared"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const resolved = parseTscShowConfig(output);

    expect(resolved.compilerOptions.paths["@nexus-form/shared"]).toEqual([
      "./packages/shared/src/index.ts",
    ]);
  });
});
