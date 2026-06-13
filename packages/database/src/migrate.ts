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
export const LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP = 1749061100000;
export const CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP = 1779930000000;

type CountRow = RowDataPacket & {
  count: number | string;
};

type ColumnNameRow = RowDataPacket & {
  columnName: string;
};

type MigrationTimestampRow = RowDataPacket & {
  createdAt: number | string | bigint;
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

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required to run migrations",
    );
  }

  const migrationClient = mysql.createPool(connectionString);
  try {
    const db = drizzle(migrationClient);
    console.log("Running database migrations...");
    await normalizeConfigJsonMigrationTimestamp(migrationClient);
    const migrationsFolder = resolve(__dirname, "../drizzle");
    await migrate(db, { migrationsFolder });
    console.log("Database migrations completed successfully");
  } catch (error) {
    console.error("Database migration failed:", error);
    throw error;
  } finally {
    await migrationClient.end();
  }
}

async function normalizeConfigJsonMigrationTimestamp(
  migrationClient: Pool,
): Promise<void> {
  // 0012 was briefly published with an older timestamp than 0011. Databases
  // that already applied it need the journal row moved forward before Drizzle
  // decides which migrations are still pending.
  const state =
    await readConfigJsonMigrationCompatibilityState(migrationClient);
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
  migrationClient: Pool,
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
