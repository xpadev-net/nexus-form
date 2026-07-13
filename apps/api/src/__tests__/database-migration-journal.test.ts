import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
  assertRequiredSecurityMigrationsAppliedWithPool,
  CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
  FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
  LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
  PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
  REQUIRED_SECURITY_MIGRATION_TAGS,
  shouldNormalizeConfigJsonMigrationTimestamp,
} from "@nexus-form/database/migrate";
import { describe, expect, it } from "vitest";

type Journal = {
  entries: Array<{
    idx: number;
    version: string;
    tag: string;
    when: number;
    breakpoints: boolean;
  }>;
};

type FakeMigrationPool = {
  query<T>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
};

type MigrationOperationContract = {
  existenceVariable: string;
  informationSchemaTable: "COLUMNS" | "STATISTICS";
  tableName: string;
  discriminator: "COLUMN_NAME" | "INDEX_NAME";
  discriminatorValue: string;
  choiceVariable: string;
  condition: string;
  existingChoice: string;
  ddlChoice: string;
  preparedStatement: string;
  prepareSource: string;
  executedStatement: string;
  deallocatedStatement: string;
};

const RETRY_METADATA_MIGRATION_TAG = "0016_zippy_alex_wilder";

const EXPECTED_RETRY_METADATA_OPERATIONS: MigrationOperationContract[] = [
  {
    existenceVariable: "nf_claim_token_exists",
    informationSchemaTable: "COLUMNS",
    tableName: "ExternalServiceValidationResult",
    discriminator: "COLUMN_NAME",
    discriminatorValue: "claimToken",
    choiceVariable: "nf_add_claim_token",
    condition: "@nf_claim_token_exists > 0",
    existingChoice: "SELECT 1",
    ddlChoice:
      "ALTER TABLE `ExternalServiceValidationResult` ADD `claimToken` varchar(128)",
    preparedStatement: "nf_add_claim_token_stmt",
    prepareSource: "nf_add_claim_token",
    executedStatement: "nf_add_claim_token_stmt",
    deallocatedStatement: "nf_add_claim_token_stmt",
  },
  {
    existenceVariable: "nf_claim_expires_at_exists",
    informationSchemaTable: "COLUMNS",
    tableName: "ExternalServiceValidationResult",
    discriminator: "COLUMN_NAME",
    discriminatorValue: "claimExpiresAt",
    choiceVariable: "nf_add_claim_expires_at",
    condition: "@nf_claim_expires_at_exists > 0",
    existingChoice: "SELECT 1",
    ddlChoice:
      "ALTER TABLE `ExternalServiceValidationResult` ADD `claimExpiresAt` timestamp",
    preparedStatement: "nf_add_claim_expires_at_stmt",
    prepareSource: "nf_add_claim_expires_at",
    executedStatement: "nf_add_claim_expires_at_stmt",
    deallocatedStatement: "nf_add_claim_expires_at_stmt",
  },
  {
    existenceVariable: "nf_enqueue_attempt_count_exists",
    informationSchemaTable: "COLUMNS",
    tableName: "ExternalServiceValidationResult",
    discriminator: "COLUMN_NAME",
    discriminatorValue: "enqueueAttemptCount",
    choiceVariable: "nf_add_enqueue_attempt_count",
    condition: "@nf_enqueue_attempt_count_exists > 0",
    existingChoice: "SELECT 1",
    ddlChoice:
      "ALTER TABLE `ExternalServiceValidationResult` ADD `enqueueAttemptCount` int DEFAULT 0 NOT NULL",
    preparedStatement: "nf_add_enqueue_attempt_count_stmt",
    prepareSource: "nf_add_enqueue_attempt_count",
    executedStatement: "nf_add_enqueue_attempt_count_stmt",
    deallocatedStatement: "nf_add_enqueue_attempt_count_stmt",
  },
  {
    existenceVariable: "nf_next_eligible_at_exists",
    informationSchemaTable: "COLUMNS",
    tableName: "ExternalServiceValidationResult",
    discriminator: "COLUMN_NAME",
    discriminatorValue: "nextEligibleAt",
    choiceVariable: "nf_add_next_eligible_at",
    condition: "@nf_next_eligible_at_exists > 0",
    existingChoice: "SELECT 1",
    ddlChoice:
      "ALTER TABLE `ExternalServiceValidationResult` ADD `nextEligibleAt` timestamp",
    preparedStatement: "nf_add_next_eligible_at_stmt",
    prepareSource: "nf_add_next_eligible_at",
    executedStatement: "nf_add_next_eligible_at_stmt",
    deallocatedStatement: "nf_add_next_eligible_at_stmt",
  },
  {
    existenceVariable: "nf_enqueue_mode_exists",
    informationSchemaTable: "COLUMNS",
    tableName: "ExternalServiceValidationResult",
    discriminator: "COLUMN_NAME",
    discriminatorValue: "validation_enqueue_mode",
    choiceVariable: "nf_add_enqueue_mode",
    condition: "@nf_enqueue_mode_exists > 0",
    existingChoice: "SELECT 1",
    ddlChoice:
      "ALTER TABLE `ExternalServiceValidationResult` ADD `validation_enqueue_mode` enum(''LEGACY'',''STABLE'') DEFAULT ''LEGACY'' NOT NULL",
    preparedStatement: "nf_add_enqueue_mode_stmt",
    prepareSource: "nf_add_enqueue_mode",
    executedStatement: "nf_add_enqueue_mode_stmt",
    deallocatedStatement: "nf_add_enqueue_mode_stmt",
  },
  {
    existenceVariable: "nf_enqueue_eligibility_lease_idx_exists",
    informationSchemaTable: "STATISTICS",
    tableName: "ExternalServiceValidationResult",
    discriminator: "INDEX_NAME",
    discriminatorValue: "ESVR_enqueue_eligibility_lease_idx",
    choiceVariable: "nf_create_enqueue_eligibility_lease_idx",
    condition: "@nf_enqueue_eligibility_lease_idx_exists > 0",
    existingChoice: "SELECT 1",
    ddlChoice:
      "CREATE INDEX `ESVR_enqueue_eligibility_lease_idx` ON `ExternalServiceValidationResult` (`validation_status`,`nextEligibleAt`,`claimExpiresAt`,`createdAt`)",
    preparedStatement: "nf_create_enqueue_eligibility_lease_idx_stmt",
    prepareSource: "nf_create_enqueue_eligibility_lease_idx",
    executedStatement: "nf_create_enqueue_eligibility_lease_idx_stmt",
    deallocatedStatement: "nf_create_enqueue_eligibility_lease_idx_stmt",
  },
];

function extractMigrationOperations(sql: string): MigrationOperationContract[] {
  const operationPattern =
    /SET @(?<existenceVariable>[a-z0-9_]+) = \(\n {2}SELECT COUNT\(\*\)\n {2}FROM `INFORMATION_SCHEMA`\.`(?<informationSchemaTable>COLUMNS|STATISTICS)`\n {2}WHERE `TABLE_SCHEMA` = DATABASE\(\)\n {4}AND `TABLE_NAME` = '(?<tableName>[^']+)'\n {4}AND `(?<discriminator>COLUMN_NAME|INDEX_NAME)` = '(?<discriminatorValue>[^']+)'\n\);--> statement-breakpoint\nSET @(?<choiceVariable>[a-z0-9_]+) = IF\(\n {2}(?<condition>@[a-z0-9_]+ > 0),\n {2}'(?<existingChoice>[^']+)',\n {2}'(?<ddlChoice>(?:''|[^'])+)'\n\);--> statement-breakpoint\nPREPARE (?<preparedStatement>[a-z0-9_]+) FROM @(?<prepareSource>[a-z0-9_]+);--> statement-breakpoint\nEXECUTE (?<executedStatement>[a-z0-9_]+);--> statement-breakpoint\nDEALLOCATE PREPARE (?<deallocatedStatement>[a-z0-9_]+);/g;

  return Array.from(sql.matchAll(operationPattern), (match) => {
    const {
      existenceVariable,
      informationSchemaTable,
      tableName,
      discriminator,
      discriminatorValue,
      choiceVariable,
      condition,
      existingChoice,
      ddlChoice,
      preparedStatement,
      prepareSource,
      executedStatement,
      deallocatedStatement,
    } = match.groups ?? {};
    if (
      !existenceVariable ||
      (informationSchemaTable !== "COLUMNS" &&
        informationSchemaTable !== "STATISTICS") ||
      !tableName ||
      (discriminator !== "COLUMN_NAME" && discriminator !== "INDEX_NAME") ||
      !discriminatorValue ||
      !choiceVariable ||
      !condition ||
      !existingChoice ||
      !ddlChoice ||
      !preparedStatement ||
      !prepareSource ||
      !executedStatement ||
      !deallocatedStatement
    ) {
      throw new Error("Malformed migration operation");
    }
    return {
      existenceVariable,
      informationSchemaTable,
      tableName,
      discriminator,
      discriminatorValue,
      choiceVariable,
      condition,
      existingChoice,
      ddlChoice,
      preparedStatement,
      prepareSource,
      executedStatement,
      deallocatedStatement,
    };
  });
}

function assertRetryMetadataMigrationContract(sql: string): void {
  const expectedOperationCount = EXPECTED_RETRY_METADATA_OPERATIONS.length;
  expect(sql.match(/SET\s+@[a-z0-9_]+_exists\s*=\s*\(/gi) ?? []).toHaveLength(
    expectedOperationCount,
  );
  expect(sql.match(/SET\s+@[a-z0-9_]+\s*=\s*IF\s*\(/gi) ?? []).toHaveLength(
    expectedOperationCount,
  );
  expect(
    sql.match(/^PREPARE\s+[a-z0-9_]+\s+FROM\s+@[a-z0-9_]+;/gim) ?? [],
  ).toHaveLength(expectedOperationCount);
  expect(sql.match(/^EXECUTE\s+[a-z0-9_]+;/gim) ?? []).toHaveLength(
    expectedOperationCount,
  );
  expect(sql.match(/^DEALLOCATE PREPARE\s+[a-z0-9_]+;/gim) ?? []).toHaveLength(
    expectedOperationCount,
  );
  expect(extractMigrationOperations(sql)).toEqual(
    EXPECTED_RETRY_METADATA_OPERATIONS,
  );
  expect(sql).not.toMatch(/\bUPDATE\s+`ExternalServiceValidationResult`/i);
  expect(sql).not.toContain("DEFAULT ''STABLE''");
  expect(sql).not.toMatch(/\b(?:DROP|MODIFY|RENAME)\b/i);
  expect(sql).not.toMatch(/`attemptCount`|`nextRetryAt`/);
}

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

function readMigration(tag: string): string {
  return readFileSync(
    resolve(
      findRepoRoot(process.cwd()),
      `packages/database/drizzle/${tag}.sql`,
    ),
    "utf8",
  );
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

  it("keeps validation outbox retry metadata additive and default-safe", () => {
    const journal = readJournal();
    const outboxEntries = journal.entries.filter((entry) =>
      entry.tag.startsWith("0016_"),
    );
    expect(outboxEntries).toHaveLength(1);

    const outboxEntry = outboxEntries[0];
    if (!outboxEntry) {
      throw new Error("Validation outbox retry migration must exist");
    }

    const previousEntry = findJournalEntryOrThrow(
      journal,
      "0015_amusing_ghost_rider",
    );
    const followingEntry = findJournalEntryOrThrow(
      journal,
      "0017_public_grant_generation",
    );

    expect(outboxEntry).toMatchObject({
      idx: 16,
      version: "5",
      tag: RETRY_METADATA_MIGRATION_TAG,
      breakpoints: true,
    });
    expect(journal.entries[outboxEntry.idx]).toEqual(outboxEntry);
    expect(journal.entries[outboxEntry.idx - 1]?.tag).toBe(previousEntry.tag);
    expect(journal.entries[outboxEntry.idx + 1]?.tag).toBe(followingEntry.tag);
    expect(outboxEntry.when).toBeGreaterThan(previousEntry.when);
    expect(followingEntry.when).toBeGreaterThan(outboxEntry.when);

    const sql = readMigration(outboxEntry.tag);
    assertRetryMetadataMigrationContract(sql);
    for (const columnName of [
      "claimToken",
      "claimExpiresAt",
      "enqueueAttemptCount",
      "nextEligibleAt",
      "validation_enqueue_mode",
    ]) {
      expect(sql).toContain(`AND \`COLUMN_NAME\` = '${columnName}'`);
    }
    expect(sql).toContain(
      "AND `INDEX_NAME` = 'ESVR_enqueue_eligibility_lease_idx'",
    );
    expect(sql).toContain("INFORMATION_SCHEMA");
    expect(sql).toContain("PREPARE");
  });

  it("rejects unsafe validation outbox migration mutations", () => {
    const sql = readMigration(RETRY_METADATA_MIGRATION_TAG);
    const claimTokenChoice = EXPECTED_RETRY_METADATA_OPERATIONS[0]?.ddlChoice;
    if (!claimTokenChoice) {
      throw new Error("Claim token DDL choice must exist");
    }

    const defaultMutation = sql.replace(
      claimTokenChoice,
      `${claimTokenChoice} DEFAULT ''claimed''`,
    );
    expect(defaultMutation).not.toBe(sql);
    expect(() =>
      assertRetryMetadataMigrationContract(defaultMutation),
    ).toThrow();

    const extraChoiceMutation = `${sql}\nSET @nf_extra_retry_column = IF(
  @nf_extra_retry_column_exists > 0,
  'SELECT 1',
  'ALTER TABLE \`ExternalServiceValidationResult\` ADD \`extraRetryColumn\` int'
);`;
    expect(() =>
      assertRetryMetadataMigrationContract(extraChoiceMutation),
    ).toThrow();

    const lowercaseDestructiveMutation = `${sql}\ndrop index \`ESVR_enqueue_eligibility_lease_idx\` ON \`ExternalServiceValidationResult\`;`;
    expect(() =>
      assertRetryMetadataMigrationContract(lowercaseDestructiveMutation),
    ).toThrow();

    const wrongTableMutation = sql.replace(
      "AND `TABLE_NAME` = 'ExternalServiceValidationResult'",
      "AND `TABLE_NAME` = 'WrongTable'",
    );
    expect(wrongTableMutation).not.toBe(sql);
    expect(() =>
      assertRetryMetadataMigrationContract(wrongTableMutation),
    ).toThrow();

    const wrongGuardVariableMutation = sql.replace(
      "@nf_claim_token_exists > 0",
      "@nf_claim_expires_at_exists > 0",
    );
    expect(wrongGuardVariableMutation).not.toBe(sql);
    expect(() =>
      assertRetryMetadataMigrationContract(wrongGuardVariableMutation),
    ).toThrow();

    const missingExecuteMutation = sql.replace(
      "EXECUTE nf_add_claim_token_stmt;--> statement-breakpoint\n",
      "",
    );
    expect(missingExecuteMutation).not.toBe(sql);
    expect(() =>
      assertRetryMetadataMigrationContract(missingExecuteMutation),
    ).toThrow();

    const wrongPrepareSourceMutation = sql.replace(
      "PREPARE nf_add_claim_token_stmt FROM @nf_add_claim_token;",
      "PREPARE nf_add_claim_token_stmt FROM @nf_add_claim_expires_at;",
    );
    expect(wrongPrepareSourceMutation).not.toBe(sql);
    expect(() =>
      assertRetryMetadataMigrationContract(wrongPrepareSourceMutation),
    ).toThrow();

    const missingDeallocateMutation = sql.replace(
      "DEALLOCATE PREPARE nf_add_claim_token_stmt;--> statement-breakpoint\n",
      "",
    );
    expect(missingDeallocateMutation).not.toBe(sql);
    expect(() =>
      assertRetryMetadataMigrationContract(missingDeallocateMutation),
    ).toThrow();

    const secondOperationOffset = sql.indexOf(
      "SET @nf_claim_expires_at_exists",
    );
    const thirdOperationOffset = sql.indexOf(
      "SET @nf_enqueue_attempt_count_exists",
    );
    if (secondOperationOffset < 0 || thirdOperationOffset < 0) {
      throw new Error("Retry metadata operation boundaries must exist");
    }
    const firstOperation = sql.slice(0, secondOperationOffset);
    const secondOperation = sql.slice(
      secondOperationOffset,
      thirdOperationOffset,
    );

    const duplicateOperationMutation = `${firstOperation}${sql}`;
    expect(() =>
      assertRetryMetadataMigrationContract(duplicateOperationMutation),
    ).toThrow();

    const reorderedOperationMutation = `${secondOperation}${firstOperation}${sql.slice(thirdOperationOffset)}`;
    expect(() =>
      assertRetryMetadataMigrationContract(reorderedOperationMutation),
    ).toThrow();
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

    const publicPasswordGrantGeneration = findJournalEntryOrThrow(
      journal,
      "0017_public_grant_generation",
    );
    expect(publicPasswordGrantGeneration.when).toBe(
      PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
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
            PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
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
            PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
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
            PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).rejects.toThrow(
      "Required security migrations were not applied: 0014_certain_speed_demon",
    );

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
    ).rejects.toThrow(
      "Required security migrations were not applied: 0017_public_grant_generation",
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
            PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
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
            PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
          ],
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
