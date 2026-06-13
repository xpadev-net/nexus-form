import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldNormalizeConfigJsonMigrationTimestamp } from "../../../../packages/database/src/migrate";

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

function readJournal(): Journal {
  const journalPath = resolve(
    findRepoRoot(process.cwd()),
    "packages/database/drizzle/meta/_journal.json",
  );
  return JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
}

describe("database migration journal", () => {
  it("keeps migration timestamps strictly increasing", () => {
    const journal = readJournal();

    for (const [index, entry] of journal.entries.entries()) {
      const previous = journal.entries[index - 1];
      if (!previous) continue;

      expect(
        entry.when,
        `${entry.tag} must be newer than ${previous.tag}`,
      ).toBeGreaterThan(previous.when);
    }
  });

  it("keeps the configJson column migration after snapshot structure backfill", () => {
    const journal = readJournal();
    const snapshotStructure = journal.entries.find(
      (entry) => entry.tag === "0011_snapshot_structure_json",
    );
    const configJsonColumn = journal.entries.find(
      (entry) => entry.tag === "0012_config_json_column_type",
    );

    expect(snapshotStructure, "0011 migration must exist").toBeDefined();
    expect(configJsonColumn, "0012 migration must exist").toBeDefined();
    if (!snapshotStructure || !configJsonColumn) {
      throw new Error("Required migrations are missing");
    }
    expect(configJsonColumn.when).toBeGreaterThan(snapshotStructure.when);
  });

  it("normalizes the legacy 0012 timestamp only after the configJson rename already ran", () => {
    expect(
      shouldNormalizeConfigJsonMigrationTimestamp({
        hasDrizzleMigrationsTable: true,
        hasLegacyConfigJsonColumn: false,
        hasCurrentConfigJsonColumn: true,
        hasLegacyConfigJsonMigrationTimestamp: true,
        hasCurrentConfigJsonMigrationTimestamp: false,
      }),
    ).toBe(true);

    expect(
      shouldNormalizeConfigJsonMigrationTimestamp({
        hasDrizzleMigrationsTable: true,
        hasLegacyConfigJsonColumn: true,
        hasCurrentConfigJsonColumn: false,
        hasLegacyConfigJsonMigrationTimestamp: false,
        hasCurrentConfigJsonMigrationTimestamp: false,
      }),
    ).toBe(false);

    expect(
      shouldNormalizeConfigJsonMigrationTimestamp({
        hasDrizzleMigrationsTable: true,
        hasLegacyConfigJsonColumn: false,
        hasCurrentConfigJsonColumn: true,
        hasLegacyConfigJsonMigrationTimestamp: true,
        hasCurrentConfigJsonMigrationTimestamp: true,
      }),
    ).toBe(false);
  });
});
