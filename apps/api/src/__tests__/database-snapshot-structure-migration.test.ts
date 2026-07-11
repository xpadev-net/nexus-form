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
  notNull: boolean;
  default?: string | number | boolean;
};

type SnapshotTable = {
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, { columns: string[] }>;
};

type DrizzleSnapshot = {
  tables: Record<string, SnapshotTable>;
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

function readCompatibilityMigration(): string {
  return readFileSync(
    resolve(
      findRepoRoot(process.cwd()),
      "packages/database/drizzle/0013_active_snapshot_structure_live_security_compat.sql",
    ),
    "utf8",
  );
}

function readRetryMetadataSnapshot(): DrizzleSnapshot {
  const repoRoot = findRepoRoot(process.cwd());
  const journal = JSON.parse(
    readFileSync(
      resolve(repoRoot, "packages/database/drizzle/meta/_journal.json"),
      "utf8",
    ),
  ) as MigrationJournal;
  const outboxEntry = journal.entries.find((entry) =>
    entry.tag.startsWith("0016_"),
  );
  if (!outboxEntry) {
    throw new Error("Validation outbox retry migration must exist");
  }

  return JSON.parse(
    readFileSync(
      resolve(repoRoot, "packages/database/drizzle/meta/0016_snapshot.json"),
      "utf8",
    ),
  ) as DrizzleSnapshot;
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
  it("records additive validation outbox retry metadata in the generated snapshot", () => {
    const table =
      readRetryMetadataSnapshot().tables.ExternalServiceValidationResult;
    expect(table).toBeDefined();

    const columns = table?.columns;
    expect(columns?.claimToken).toMatchObject({
      name: "claimToken",
      type: "varchar(128)",
      notNull: false,
    });
    expect(columns?.claimExpiresAt).toMatchObject({
      name: "claimExpiresAt",
      type: "timestamp",
      notNull: false,
    });
    expect(columns?.enqueueAttemptCount).toMatchObject({
      name: "enqueueAttemptCount",
      type: "int",
      notNull: true,
      default: 0,
    });
    expect(columns?.nextEligibleAt).toMatchObject({
      name: "nextEligibleAt",
      type: "timestamp",
      notNull: false,
    });
    expect(columns?.validation_enqueue_mode).toMatchObject({
      name: "validation_enqueue_mode",
      type: "enum('LEGACY','STABLE')",
      notNull: true,
      default: "'LEGACY'",
    });
    expect(table?.indexes.ESVR_enqueue_eligibility_lease_idx).toMatchObject({
      columns: [
        "validation_status",
        "nextEligibleAt",
        "claimExpiresAt",
        "createdAt",
      ],
    });
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
