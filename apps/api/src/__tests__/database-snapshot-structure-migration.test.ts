import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SnapshotFixture = {
  id: string;
  formId: string;
  isActive: boolean;
  structureJson: string;
};

type StructureFixture = {
  id: string;
  formId: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  structureJson: string;
};

type MigrationJournal = {
  entries: Array<{ tag: string }>;
};

type SnapshotColumn = {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  autoincrement: boolean;
  default?: string | number | boolean;
};

type SnapshotIndex = {
  name: string;
  columns: string[];
  isUnique: boolean;
};

type SnapshotTable = {
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
};

type DrizzleSnapshot = {
  id: string;
  prevId: string;
  tables: Record<string, SnapshotTable>;
};

const RETRY_METADATA_MIGRATION_TAG = "0016_zippy_alex_wilder";

const EXPECTED_RETRY_METADATA_COLUMNS = {
  claimToken: {
    name: "claimToken",
    type: "varchar(128)",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  },
  claimExpiresAt: {
    name: "claimExpiresAt",
    type: "timestamp",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  },
  enqueueAttemptCount: {
    name: "enqueueAttemptCount",
    type: "int",
    primaryKey: false,
    notNull: true,
    autoincrement: false,
    default: 0,
  },
  nextEligibleAt: {
    name: "nextEligibleAt",
    type: "timestamp",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  },
  validation_enqueue_mode: {
    name: "validation_enqueue_mode",
    type: "enum('LEGACY','STABLE')",
    primaryKey: false,
    notNull: true,
    autoincrement: false,
    default: "'LEGACY'",
  },
} satisfies Record<string, SnapshotColumn>;

const EXPECTED_RETRY_METADATA_INDEX = {
  name: "ESVR_enqueue_eligibility_lease_idx",
  columns: [
    "validation_status",
    "nextEligibleAt",
    "claimExpiresAt",
    "createdAt",
  ],
  isUnique: false,
} satisfies SnapshotIndex;

function assertRetryMetadataSnapshotShape(table: SnapshotTable): void {
  const columns = Object.fromEntries(
    Object.keys(EXPECTED_RETRY_METADATA_COLUMNS).map((columnName) => [
      columnName,
      table.columns[columnName],
    ]),
  );

  expect({
    columns,
    index: table.indexes.ESVR_enqueue_eligibility_lease_idx,
  }).toEqual({
    columns: EXPECTED_RETRY_METADATA_COLUMNS,
    index: EXPECTED_RETRY_METADATA_INDEX,
  });
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

function readCompatibilityMigration(): string {
  return readFileSync(
    resolve(
      findRepoRoot(process.cwd()),
      "packages/database/drizzle/0013_active_snapshot_structure_live_security_compat.sql",
    ),
    "utf8",
  );
}

function readMigrationJournal(): MigrationJournal {
  const repoRoot = findRepoRoot(process.cwd());
  return JSON.parse(
    readFileSync(
      resolve(repoRoot, "packages/database/drizzle/meta/_journal.json"),
      "utf8",
    ),
  ) as MigrationJournal;
}

function readSnapshotForMigrationTag(tag: string): DrizzleSnapshot {
  const migrationPrefix = tag.split("_").at(0);
  if (!migrationPrefix) {
    throw new Error(`Invalid migration tag: ${tag}`);
  }

  return JSON.parse(
    readFileSync(
      resolve(
        findRepoRoot(process.cwd()),
        `packages/database/drizzle/meta/${migrationPrefix}_snapshot.json`,
      ),
      "utf8",
    ),
  ) as DrizzleSnapshot;
}

function readRetryMetadataSnapshot(): DrizzleSnapshot {
  const outboxEntry = readMigrationJournal().entries.find(
    (entry) => entry.tag === RETRY_METADATA_MIGRATION_TAG,
  );
  if (!outboxEntry) {
    throw new Error("Validation outbox retry migration must exist");
  }

  return readSnapshotForMigrationTag(outboxEntry.tag);
}

function compareStructuresByLiveOrder(
  left: StructureFixture,
  right: StructureFixture,
): number {
  if (left.version !== right.version) {
    return right.version - left.version;
  }

  const createdAtDiff =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  if (left.id === right.id) {
    return 0;
  }
  return left.id > right.id ? -1 : 1;
}

function applyCompatibilityRule(
  snapshots: SnapshotFixture[],
  structures: StructureFixture[],
): SnapshotFixture[] {
  const latestActiveStructureByForm = new Map<string, StructureFixture>();

  for (const structure of structures
    .filter((candidate) => candidate.isActive)
    .sort(compareStructuresByLiveOrder)) {
    if (!latestActiveStructureByForm.has(structure.formId)) {
      latestActiveStructureByForm.set(structure.formId, structure);
    }
  }

  return snapshots.map((snapshot) => {
    if (!snapshot.isActive) {
      return snapshot;
    }

    const latestStructure = latestActiveStructureByForm.get(snapshot.formId);
    if (!latestStructure) {
      return snapshot;
    }

    return {
      ...snapshot,
      structureJson: latestStructure.structureJson,
    };
  });
}

const publishedOpenStructure = JSON.stringify({
  version: 1,
  settings: {
    allow_edit_responses: false,
    require_fingerprint: false,
  },
});

const liveSecurityStructure = JSON.stringify({
  version: 1,
  access_control: {
    password_protection: {
      enabled: true,
      password: "$2b$10$hashed-live-password",
      password_hint: "team code",
    },
  },
  settings: {
    allow_edit_responses: false,
    require_fingerprint: true,
    response_limit: {
      enabled: true,
      max_responses: 25,
      message: "Closed",
    },
  },
});

describe("active snapshot structure security compatibility migration", () => {
  it("links the validation outbox retry snapshot in generated journal order", () => {
    const journal = readMigrationJournal();
    const retryIndex = journal.entries.findIndex(
      (entry) => entry.tag === RETRY_METADATA_MIGRATION_TAG,
    );
    const previousEntry = journal.entries[retryIndex - 1];
    const retryEntry = journal.entries[retryIndex];
    const followingEntry = journal.entries[retryIndex + 1];
    if (!previousEntry || !retryEntry || !followingEntry) {
      throw new Error("Validation outbox retry snapshot must have neighbors");
    }

    const previousSnapshot = readSnapshotForMigrationTag(previousEntry.tag);
    const retrySnapshot = readSnapshotForMigrationTag(retryEntry.tag);
    const followingSnapshot = readSnapshotForMigrationTag(followingEntry.tag);

    expect(retrySnapshot.prevId).toBe(previousSnapshot.id);
    expect(followingSnapshot.prevId).toBe(retrySnapshot.id);
  });

  it("records additive validation outbox retry metadata in the generated snapshot", () => {
    const table =
      readRetryMetadataSnapshot().tables.ExternalServiceValidationResult;
    if (!table) {
      throw new Error("Validation outbox table must exist");
    }

    assertRetryMetadataSnapshotShape(table);
  });

  it("rejects unsafe validation outbox snapshot mutations", () => {
    const table =
      readRetryMetadataSnapshot().tables.ExternalServiceValidationResult;
    const claimToken = table?.columns.claimToken;
    const eligibilityIndex = table?.indexes.ESVR_enqueue_eligibility_lease_idx;
    if (!table || !claimToken || !eligibilityIndex) {
      throw new Error("Validation outbox retry metadata must exist");
    }

    const defaultMutation: SnapshotTable = {
      ...table,
      columns: {
        ...table.columns,
        claimToken: { ...claimToken, default: "'claimed'" },
      },
    };
    expect(() => assertRetryMetadataSnapshotShape(defaultMutation)).toThrow();

    const uniqueIndexMutation: SnapshotTable = {
      ...table,
      indexes: {
        ...table.indexes,
        ESVR_enqueue_eligibility_lease_idx: {
          ...eligibilityIndex,
          isUnique: true,
        },
      },
    };
    expect(() =>
      assertRetryMetadataSnapshotShape(uniqueIndexMutation),
    ).toThrow();
  });

  it("preserves the pre-migration schema read by rollback readers", () => {
    const previousSnapshot = readSnapshotForMigrationTag(
      "0015_amusing_ghost_rider",
    );
    const retrySnapshot = readRetryMetadataSnapshot();
    const previousTable =
      previousSnapshot.tables.ExternalServiceValidationResult;
    const retryTable = retrySnapshot.tables.ExternalServiceValidationResult;
    if (!previousTable || !retryTable) {
      throw new Error("Validation outbox table must exist in both snapshots");
    }

    expect(Object.keys(retrySnapshot.tables)).toEqual(
      Object.keys(previousSnapshot.tables),
    );
    for (const [tableName, previousTableShape] of Object.entries(
      previousSnapshot.tables,
    )) {
      if (tableName === "ExternalServiceValidationResult") continue;
      expect(
        retrySnapshot.tables[tableName],
        `${tableName} must be unchanged`,
      ).toEqual(previousTableShape);
    }

    const {
      columns: previousColumns,
      indexes: previousIndexes,
      ...previousTableMetadata
    } = previousTable;
    const {
      columns: retryColumns,
      indexes: retryIndexes,
      ...retryTableMetadata
    } = retryTable;

    expect(retryTableMetadata).toEqual(previousTableMetadata);
    for (const [columnName, previousColumn] of Object.entries(
      previousColumns,
    )) {
      expect(
        retryColumns[columnName],
        `${columnName} must remain readable by the previous schema`,
      ).toEqual(previousColumn);
    }
    for (const [indexName, previousIndex] of Object.entries(previousIndexes)) {
      expect(
        retryIndexes[indexName],
        `${indexName} must remain compatible with the previous schema`,
      ).toEqual(previousIndex);
    }

    expect(
      Object.keys(retryColumns).filter(
        (columnName) => !(columnName in previousColumns),
      ),
    ).toEqual([
      "claimToken",
      "claimExpiresAt",
      "enqueueAttemptCount",
      "nextEligibleAt",
      "validation_enqueue_mode",
    ]);
    expect(
      Object.keys(retryIndexes).filter(
        (indexName) => !(indexName in previousIndexes),
      ),
    ).toEqual(["ESVR_enqueue_eligibility_lease_idx"]);
  });

  it("updates active snapshots to the latest active live security structure", () => {
    const snapshots: SnapshotFixture[] = [
      {
        id: "snapshot-active",
        formId: "form-live-security",
        isActive: true,
        structureJson: publishedOpenStructure,
      },
    ];
    const structures: StructureFixture[] = [
      {
        id: "structure-old",
        formId: "form-live-security",
        isActive: false,
        version: 1,
        createdAt: "2026-05-01T00:00:00.000Z",
        structureJson: publishedOpenStructure,
      },
      {
        id: "structure-live",
        formId: "form-live-security",
        isActive: true,
        version: 2,
        createdAt: "2026-05-02T00:00:00.000Z",
        structureJson: liveSecurityStructure,
      },
    ];

    const snapshot = applyCompatibilityRule(snapshots, structures).at(0);
    expect(snapshot).toBeDefined();
    if (!snapshot) {
      throw new Error("Expected migrated snapshot");
    }
    const migratedStructure = JSON.parse(snapshot.structureJson);

    expect(migratedStructure.access_control.password_protection).toMatchObject({
      enabled: true,
      password: "$2b$10$hashed-live-password",
      password_hint: "team code",
    });
    expect(migratedStructure.settings).toMatchObject({
      allow_edit_responses: false,
      require_fingerprint: true,
      response_limit: {
        enabled: true,
        max_responses: 25,
        message: "Closed",
      },
    });
  });

  it("does not rewrite inactive snapshots or active snapshots without live structures", () => {
    const inactiveSnapshot: SnapshotFixture = {
      id: "snapshot-inactive",
      formId: "form-live-security",
      isActive: false,
      structureJson: publishedOpenStructure,
    };
    const orphanActiveSnapshot: SnapshotFixture = {
      id: "snapshot-active-no-structure",
      formId: "form-without-structure",
      isActive: true,
      structureJson: publishedOpenStructure,
    };

    const migrated = applyCompatibilityRule(
      [inactiveSnapshot, orphanActiveSnapshot],
      [
        {
          id: "structure-live",
          formId: "form-live-security",
          isActive: true,
          version: 2,
          createdAt: "2026-05-02T00:00:00.000Z",
          structureJson: liveSecurityStructure,
        },
      ],
    );

    expect(migrated).toEqual([inactiveSnapshot, orphanActiveSnapshot]);
  });

  it("filters the SQL migration to active snapshots and active live structures", () => {
    const sql = readCompatibilityMigration();

    expect(sql).toContain("UPDATE `FormSnapshot` AS `Snapshot`");
    expect(sql).toContain("FROM `FormStructure`");
    expect(sql).toContain("WHERE `isActive` = true");
    expect(sql).toContain("WHERE `Snapshot`.`isActive` = true");
    expect(sql).toContain(
      "SET `Snapshot`.`structureJson` = `LatestActiveStructure`.`structureJson`",
    );
    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain("PARTITION BY `formId`");
    expect(sql).toContain(
      "ORDER BY\n          `version` DESC,\n          `createdAt` DESC,\n          `id` DESC",
    );
  });
});
