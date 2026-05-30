import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = {
  entries: Array<{
    tag: string;
    when: number;
  }>;
};

function findRepoRoot(startDir: string): string {
  let currentDir = startDir;
  while (true) {
    if (existsSync(resolve(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not locate repository root");
    }
    currentDir = parentDir;
  }
}

describe("database migration journal", () => {
  it("keeps migration timestamps strictly increasing", () => {
    const journalPath = resolve(
      findRepoRoot(process.cwd()),
      "packages/database/drizzle/meta/_journal.json",
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

    for (const [index, entry] of journal.entries.entries()) {
      const previous = journal.entries[index - 1];
      if (!previous) continue;

      expect(
        entry.when,
        `${entry.tag} must be newer than ${previous.tag}`,
      ).toBeGreaterThan(previous.when);
    }
  });
});
