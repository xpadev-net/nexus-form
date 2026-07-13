import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { RowDataPacket } from "mysql2";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const PREFLIGHT_MAX_ATTEMPTS = 3;
const PREFLIGHT_RETRY_BASE_DELAY_MS = 250;
const PREFLIGHT_RETRY_MAX_DELAY_MS = 1_000;
const TRANSIENT_PREFLIGHT_ERROR_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
  "ETIMEDOUT",
]);
export const REQUIRED_SECURITY_MIGRATION_TAGS = [
  "0012_config_json_column_type",
  "0013_active_snapshot_structure_live_security_compat",
  "0014_certain_speed_demon",
  "0017_public_grant_generation",
] as const;
export const LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP = 1749061100000;
export const CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP = 1779930000000;
export const ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP = 1780203531326;
export const FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP = 1781598249176;
export const PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP = 1783946776757;
// Drizzle's MySQL journal stores the canonical `when` value as `created_at`;
// migration tags are not persisted and cannot be used for runtime checks.
const REQUIRED_SECURITY_MIGRATIONS = [
  {
    tag: "0012_config_json_column_type",
    createdAt: CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
  },
  {
    tag: "0013_active_snapshot_structure_live_security_compat",
    createdAt: ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
  },
  {
    tag: "0014_certain_speed_demon",
    createdAt: FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
  },
  {
    tag: "0017_public_grant_generation",
    createdAt: PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
  },
] as const;

type RunMigrationsOptions = {
  migrationsFolder?: string;
};

type PreflightReadyMigrationClient = {
  migrationClient: Pool;
  compatibilityState: ConfigJsonMigrationCompatibilityState;
};

type CountRow = RowDataPacket & {
  count: number | string;
};

type ColumnNameRow = RowDataPacket & {
  columnName: string;
};

type MigrationTimestampRow = RowDataPacket & {
  createdAt: number | string | bigint;
};

type RequiredMigrationQueryClient = {
  query<T extends RowDataPacket[]>(
    sql: string,
    values?: unknown[],
  ): Promise<[T, unknown]>;
};

export type ConfigJsonMigrationCompatibilityState = {
  hasDrizzleMigrationsTable: boolean;
  hasLegacyConfigJsonColumn: boolean;
  hasCurrentConfigJsonColumn: boolean;
  hasLegacyConfigJsonMigrationTimestamp: boolean;
  hasCurrentConfigJsonMigrationTimestamp: boolean;
};

export function shouldNormalizeConfigJsonMigrationTimestamp(
  state: ConfigJsonMigrationCompatibilityState,
): boolean {
  return (
    state.hasDrizzleMigrationsTable &&
    state.hasCurrentConfigJsonColumn &&
    !state.hasLegacyConfigJsonColumn &&
    state.hasLegacyConfigJsonMigrationTimestamp &&
    !state.hasCurrentConfigJsonMigrationTimestamp
  );
}

export async function runMigrations(
  options: RunMigrationsOptions = {},
): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required to run migrations",
    );
  }

  let migrationClient: Pool | undefined;
  try {
    const preflight =
      await createPreflightReadyMigrationClient(connectionString);
    migrationClient = preflight.migrationClient;
    await normalizeConfigJsonMigrationTimestamp(
      migrationClient,
      preflight.compatibilityState,
    );
    const db = drizzle(migrationClient);
    console.log("Running database migrations...");
    const migrationsFolder = resolveMigrationsFolder(options.migrationsFolder);
    await migrate(db, { migrationsFolder });
    await assertRequiredSecurityMigrationsAppliedWithPool(migrationClient);
    console.log("Database migrations completed successfully");
  } catch (error) {
    console.error("Database migration failed:", error);
    throw error;
  } finally {
    await migrationClient?.end();
  }
}

async function createPreflightReadyMigrationClient(
  connectionString: string,
): Promise<PreflightReadyMigrationClient> {
  for (let attempt = 1; attempt <= PREFLIGHT_MAX_ATTEMPTS; attempt += 1) {
    const migrationClient = mysql.createPool(connectionString);

    try {
      const compatibilityState =
        await readConfigJsonMigrationCompatibilityState(migrationClient);
      return { migrationClient, compatibilityState };
    } catch (error) {
      try {
        await migrationClient.end();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Migration compatibility preflight and client cleanup both failed",
          { cause: error },
        );
      }

      if (
        !isTransientPreflightConnectionError(error) ||
        attempt === PREFLIGHT_MAX_ATTEMPTS
      ) {
        throw error;
      }

      const delayMs = Math.min(
        PREFLIGHT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        PREFLIGHT_RETRY_MAX_DELAY_MS,
      );
      console.warn(
        `Migration compatibility preflight connection failed; retrying with a fresh client (${attempt + 1}/${PREFLIGHT_MAX_ATTEMPTS})`,
      );
      await wait(delayMs);
    }
  }

  throw new Error("Migration compatibility preflight exhausted unexpectedly");
}

function isTransientPreflightConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (
    typeof error.code === "string" &&
    TRANSIENT_PREFLIGHT_ERROR_CODES.has(error.code)
  );
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, delayMs);
  });
}

export async function assertRequiredSecurityMigrationsApplied(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const migrationClient = mysql.createPool(connectionString);
  try {
    await assertRequiredSecurityMigrationsAppliedWithPool(migrationClient);
  } finally {
    await migrationClient.end();
  }
}

async function normalizeConfigJsonMigrationTimestamp(
  migrationClient: Pool,
  state: ConfigJsonMigrationCompatibilityState,
): Promise<void> {
  // 0012 was briefly published with an older timestamp than 0011. Databases
  // that already applied it need the journal row moved forward before Drizzle
  // decides which migrations are still pending.
  if (!shouldNormalizeConfigJsonMigrationTimestamp(state)) {
    return;
  }

  const [result] = await migrationClient.query<ResultSetHeader>(
    "UPDATE `__drizzle_migrations` SET `created_at` = ? WHERE `created_at` = ?",
    [
      CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
      LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
    ],
  );

  if (result.affectedRows > 0) {
    console.log(
      "Normalized legacy 0012_config_json_column_type migration timestamp for Drizzle compatibility",
    );
  }
}

export async function assertRequiredSecurityMigrationsAppliedWithPool(
  migrationClient: RequiredMigrationQueryClient,
): Promise<void> {
  const hasDrizzleMigrationsTable =
    await readHasDrizzleMigrationsTable(migrationClient);
  if (!hasDrizzleMigrationsTable) {
    throw new Error(
      "Required security migrations were not applied: __drizzle_migrations table is missing",
    );
  }

  const requiredCreatedAts = REQUIRED_SECURITY_MIGRATIONS.map(
    (migration) => migration.createdAt,
  );
  const requiredCreatedAtPlaceholders = requiredCreatedAts
    .map(() => "?")
    .join(", ");
  const [rows] = await migrationClient.query<MigrationTimestampRow[]>(
    `SELECT created_at AS createdAt
      FROM ${DRIZZLE_MIGRATIONS_TABLE}
      WHERE created_at IN (${requiredCreatedAtPlaceholders})`,
    requiredCreatedAts,
  );

  const appliedCreatedAts = new Set(rows.map((row) => Number(row.createdAt)));
  const missing = REQUIRED_SECURITY_MIGRATIONS.filter(
    (migration) => !appliedCreatedAts.has(migration.createdAt),
  ).map((migration) => migration.tag);
  if (missing.length > 0) {
    throw new Error(
      `Required security migrations were not applied: ${missing.join(", ")}`,
    );
  }

  const [timestampRows] = await migrationClient.query<MigrationTimestampRow[]>(
    `SELECT created_at AS createdAt
     FROM ${DRIZZLE_MIGRATIONS_TABLE}
     WHERE created_at IN (?, ?)`,
    [
      LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
      CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
    ],
  );
  const configJsonMigrationTimestamps = new Set(
    timestampRows.map((row) => Number(row.createdAt)),
  );
  if (
    configJsonMigrationTimestamps.has(LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP)
  ) {
    throw new Error(
      `0012 migration timestamp must be ${CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP} but found ${LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP}`,
    );
  }
}

function resolveMigrationsFolder(explicitPath?: string): string {
  const explicitMigrationsFolder = explicitPath?.trim();
  if (explicitMigrationsFolder) {
    return resolve(explicitMigrationsFolder);
  }

  const packageMigrationsFolder = resolve(__dirname, "../drizzle");
  if (existsSync(packageMigrationsFolder)) {
    return packageMigrationsFolder;
  }

  const workspaceMigrationsFolder = resolve(
    process.cwd(),
    "packages/database/drizzle",
  );
  if (existsSync(workspaceMigrationsFolder)) {
    return workspaceMigrationsFolder;
  }

  const rootMigrationsFolder = resolve(process.cwd(), "drizzle");
  if (existsSync(rootMigrationsFolder)) {
    return rootMigrationsFolder;
  }

  return packageMigrationsFolder;
}

async function readConfigJsonMigrationCompatibilityState(
  migrationClient: Pool,
): Promise<ConfigJsonMigrationCompatibilityState> {
  const hasDrizzleMigrationsTable =
    await readHasDrizzleMigrationsTable(migrationClient);
  if (!hasDrizzleMigrationsTable) {
    return {
      hasDrizzleMigrationsTable,
      hasLegacyConfigJsonColumn: false,
      hasCurrentConfigJsonColumn: false,
      hasLegacyConfigJsonMigrationTimestamp: false,
      hasCurrentConfigJsonMigrationTimestamp: false,
    };
  }

  const [columnNames, migrationTimestamps] = await Promise.all([
    readFormIntegrationConfigColumnNames(migrationClient),
    readConfigJsonMigrationTimestamps(migrationClient),
  ]);

  return {
    hasDrizzleMigrationsTable,
    hasLegacyConfigJsonColumn: columnNames.has("config_json"),
    hasCurrentConfigJsonColumn: columnNames.has("configJson"),
    hasLegacyConfigJsonMigrationTimestamp: migrationTimestamps.has(
      LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
    ),
    hasCurrentConfigJsonMigrationTimestamp: migrationTimestamps.has(
      CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
    ),
  };
}

async function readHasDrizzleMigrationsTable(
  migrationClient: RequiredMigrationQueryClient,
): Promise<boolean> {
  const [rows] = await migrationClient.query<CountRow[]>(
    `SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [DRIZZLE_MIGRATIONS_TABLE],
  );

  return Number(rows[0]?.count ?? 0) > 0;
}

async function readFormIntegrationConfigColumnNames(
  migrationClient: Pool,
): Promise<Set<string>> {
  const [rows] = await migrationClient.query<ColumnNameRow[]>(
    `SELECT COLUMN_NAME AS columnName
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'FormIntegration'
        AND COLUMN_NAME IN ('config_json', 'configJson')`,
  );

  return new Set(rows.map((row) => row.columnName));
}

async function readConfigJsonMigrationTimestamps(
  migrationClient: Pool,
): Promise<Set<number>> {
  const [rows] = await migrationClient.query<MigrationTimestampRow[]>(
    `SELECT created_at AS createdAt
      FROM \`__drizzle_migrations\`
      WHERE created_at IN (?, ?)`,
    [
      LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
      CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
    ],
  );

  return new Set(rows.map((row) => Number(row.createdAt)));
}
