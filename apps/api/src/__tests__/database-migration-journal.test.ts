import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
  assertRequiredSecurityMigrationsAppliedWithPool,
  CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
  FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
  LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
  REQUIRED_SECURITY_MIGRATION_TAGS,
  shouldNormalizeConfigJsonMigrationTimestamp,
} from "@nexus-form/database/migrate";
import { describe, expect, it } from "vitest";

type Journal = {
  entries: Array<{
    tag: string;
    when: number;
  }>;
};

type FakeMigrationPool = {
  query<T>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
};

function findJournalEntryOrThrow(journal: Journal, tag: string) {
  const entry = journal.entries.find((candidate) => candidate.tag === tag);
  if (!entry) {
    throw new Error(`${tag} migration must exist`);
  }
  return entry;
}

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

function createFakeMigrationPool(options: {
  hasDrizzleMigrationsTable: boolean;
  createdAts: number[];
}): FakeMigrationPool {
  return {
    async query<T>(sql: string, values: unknown[] = []): Promise<[T, unknown]> {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        return [
          [{ count: options.hasDrizzleMigrationsTable ? 1 : 0 }] as T,
          [],
        ];
      }

      if (sql.includes("FROM __drizzle_migrations")) {
        const requestedCreatedAts = new Set(
          values.map((value) => Number(value)),
        );
        const rows = options.createdAts
          .filter((createdAt) => requestedCreatedAts.has(createdAt))
          .map((createdAt) => ({ createdAt }));
        return [rows as T, []];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
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
    const snapshotStructure = findJournalEntryOrThrow(
      journal,
      "0011_snapshot_structure_json",
    );
    const configJsonColumn = findJournalEntryOrThrow(
      journal,
      "0012_config_json_column_type",
    );

    expect(configJsonColumn.when).toBeGreaterThan(snapshotStructure.when);
    expect(configJsonColumn.when).toBe(CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP);
  });

  it("keeps migration order and required security migrations", () => {
    const journal = readJournal();

    const indexByTag = new Map<string, number>(
      journal.entries.map((entry, index) => [entry.tag, index]),
    );

    for (
      let index = 1;
      index < REQUIRED_SECURITY_MIGRATION_TAGS.length;
      index += 1
    ) {
      const previous = REQUIRED_SECURITY_MIGRATION_TAGS[index - 1];
      const current = REQUIRED_SECURITY_MIGRATION_TAGS[index];
      if (previous === undefined || current === undefined) {
        throw new Error("Required security migration tag is missing");
      }

      const previousIndex = indexByTag.get(previous);
      const currentIndex = indexByTag.get(current);

      expect(indexByTag.has(previous), `journal index for ${previous}`).toBe(
        true,
      );
      expect(indexByTag.has(current), `journal index for ${current}`).toBe(
        true,
      );

      if (previousIndex === undefined || currentIndex === undefined) {
        throw new Error("Required migrations are missing");
      }

      expect(
        currentIndex,
        `${current} must run after ${previous}`,
      ).toBeGreaterThan(previousIndex);

      const previousEntry = journal.entries[previousIndex];
      const currentEntry = journal.entries[currentIndex];
      if (!previousEntry || !currentEntry) {
        throw new Error("Required migrations are missing");
      }

      expect(
        currentEntry.when,
        `${current} timestamp must be after ${previous}`,
      ).toBeGreaterThan(previousEntry.when);
      if (current === "0012_config_json_column_type") {
        expect(currentEntry.when).toBe(CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP);
      }
    }

    const activeSnapshotStructure = findJournalEntryOrThrow(
      journal,
      "0013_active_snapshot_structure_live_security_compat",
    );
    expect(activeSnapshotStructure.when).toBe(
      ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
    );

    const formStructureUniqueConstraints = findJournalEntryOrThrow(
      journal,
      "0014_certain_speed_demon",
    );
    expect(formStructureUniqueConstraints.when).toBe(
      FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
    );
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

    expect(
      shouldNormalizeConfigJsonMigrationTimestamp({
        hasDrizzleMigrationsTable: false,
        hasLegacyConfigJsonColumn: false,
        hasCurrentConfigJsonColumn: true,
        hasLegacyConfigJsonMigrationTimestamp: true,
        hasCurrentConfigJsonMigrationTimestamp: false,
      }),
    ).toBe(false);
  });

  it("fails closed when the required security migration journal table is missing", async () => {
    await expect(
      assertRequiredSecurityMigrationsAppliedWithPool(
        createFakeMigrationPool({
          hasDrizzleMigrationsTable: false,
          createdAts: [],
        }),
      ),
    ).rejects.toThrow(
      "Required security migrations were not applied: __drizzle_migrations table is missing",
    );
  });

  it("fails closed when required security migration timestamps are missing", async () => {
    await expect(
      assertRequiredSecurityMigrationsAppliedWithPool(
        createFakeMigrationPool({
          hasDrizzleMigrationsTable: true,
          createdAts: [
            CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
            FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).rejects.toThrow(
      "Required security migrations were not applied: 0013_active_snapshot_structure_live_security_compat",
    );

    await expect(
      assertRequiredSecurityMigrationsAppliedWithPool(
        createFakeMigrationPool({
          hasDrizzleMigrationsTable: true,
          createdAts: [
            ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
            FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).rejects.toThrow(
      "Required security migrations were not applied: 0012_config_json_column_type",
    );

    await expect(
      assertRequiredSecurityMigrationsAppliedWithPool(
        createFakeMigrationPool({
          hasDrizzleMigrationsTable: true,
          createdAts: [
            CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
            ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).rejects.toThrow(
      "Required security migrations were not applied: 0014_certain_speed_demon",
    );
  });

  it("fails closed when the legacy 0012 timestamp remains in the migration journal", async () => {
    await expect(
      assertRequiredSecurityMigrationsAppliedWithPool(
        createFakeMigrationPool({
          hasDrizzleMigrationsTable: true,
          createdAts: [
            LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
            CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
            ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
            FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).rejects.toThrow(
      `0012 migration timestamp must be ${CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP} but found ${LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP}`,
    );
  });

  it("passes when current required security migration timestamps are present", async () => {
    await expect(
      assertRequiredSecurityMigrationsAppliedWithPool(
        createFakeMigrationPool({
          hasDrizzleMigrationsTable: true,
          createdAts: [
            CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
            ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
            FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
