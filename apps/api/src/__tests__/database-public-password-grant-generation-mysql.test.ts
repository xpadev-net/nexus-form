import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP } from "@nexus-form/database/migrate";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { RowDataPacket } from "mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationTag = "0017_public_grant_generation";
const databaseUrl = process.env.DATABASE_URL?.trim();

type CountRow = RowDataPacket & {
  count: number | string;
};

type ColumnMetadataRow = RowDataPacket & {
  columnDefault: string | null;
  columnType: string;
  extra: string;
  generationExpression: string;
  isNullable: "YES" | "NO";
};

type GenerationRow = RowDataPacket & {
  generation: number | string | bigint | null;
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

function requireDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for MySQL migration tests");
  }
  return databaseUrl;
}

function readMigrationSql(): string {
  return readFileSync(
    resolve(
      findRepoRoot(process.cwd()),
      `packages/database/drizzle/${migrationTag}.sql`,
    ),
    "utf8",
  );
}

async function readColumnMetadata(pool: Pool): Promise<ColumnMetadataRow> {
  const [rows] = await pool.query<ColumnMetadataRow[]>(
    `SELECT
      COLUMN_TYPE AS columnType,
      IS_NULLABLE AS isNullable,
      COLUMN_DEFAULT AS columnDefault,
      EXTRA AS extra,
      GENERATION_EXPRESSION AS generationExpression
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Form'
      AND COLUMN_NAME = 'publicPasswordGrantGeneration'`,
  );
  const row = rows[0];
  if (!row) {
    throw new Error("publicPasswordGrantGeneration metadata must exist");
  }
  return row;
}

async function readMigrationJournalCount(pool: Pool): Promise<number> {
  const [rows] = await pool.query<CountRow[]>(
    "SELECT COUNT(*) AS count FROM `__drizzle_migrations` WHERE `created_at` = ?",
    [PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP],
  );
  return Number(rows[0]?.count ?? 0);
}

describe.skipIf(!databaseUrl)(
  "public password grant generation MySQL migration",
  () => {
    let migrationsFolder = "";

    beforeAll(() => {
      migrationsFolder = mkdtempSync(
        join(tmpdir(), "nexus-form-public-grant-migration-"),
      );
      mkdirSync(join(migrationsFolder, "meta"));
      writeFileSync(
        join(migrationsFolder, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "mysql",
          entries: [
            {
              idx: 0,
              version: "7",
              when: PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
              tag: migrationTag,
              breakpoints: true,
            },
          ],
        }),
      );
      writeFileSync(
        join(migrationsFolder, `${migrationTag}.sql`),
        readMigrationSql(),
      );
    });

    afterAll(() => {
      if (migrationsFolder) {
        rmSync(migrationsFolder, { recursive: true, force: true });
      }
    });

    async function withTestDatabase(
      run: (pool: Pool) => Promise<void>,
    ): Promise<void> {
      const sourceUrl = new URL(requireDatabaseUrl());
      const adminUrl = new URL(sourceUrl);
      adminUrl.pathname = "/";
      const databaseName = `nexus_form_grant_${randomUUID().replaceAll("-", "")}`;
      const admin = await mysql.createConnection(adminUrl.toString());
      try {
        await admin.query(`CREATE DATABASE \`${databaseName}\``);
        const testUrl = new URL(sourceUrl);
        testUrl.pathname = `/${databaseName}`;
        const pool = mysql.createPool(testUrl.toString());
        try {
          await run(pool);
        } finally {
          await pool.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await admin.end();
      }
    }

    async function runMigration(pool: Pool): Promise<void> {
      await migrate(drizzle(pool), { migrationsFolder });
    }

    it("adds and backfills the target generation on an existing Form", async () => {
      await withTestDatabase(async (pool) => {
        await pool.query(
          "CREATE TABLE `Form` (`id` varchar(191) PRIMARY KEY NOT NULL)",
        );
        await pool.query("INSERT INTO `Form` (`id`) VALUES ('existing-form')");

        await runMigration(pool);

        expect(await readColumnMetadata(pool)).toEqual({
          columnType: "bigint unsigned",
          isNullable: "NO",
          columnDefault: "1",
          extra: "",
          generationExpression: "",
        });
        const [rows] = await pool.query<GenerationRow[]>(
          "SELECT `publicPasswordGrantGeneration` AS generation FROM `Form` WHERE `id` = 'existing-form'",
        );
        expect(Number(rows[0]?.generation)).toBe(1);
        expect(await readMigrationJournalCount(pool)).toBe(1);
      });
    });

    it("recovers after ADD auto-commit and remains safe after full apply", async () => {
      await withTestDatabase(async (pool) => {
        await pool.query(
          "CREATE TABLE `Form` (`id` varchar(191) PRIMARY KEY NOT NULL, `publicPasswordGrantGeneration` bigint unsigned DEFAULT 1 NOT NULL)",
        );
        await pool.query("INSERT INTO `Form` (`id`) VALUES ('existing-form')");

        await runMigration(pool);
        await runMigration(pool);

        expect(await readColumnMetadata(pool)).toEqual({
          columnType: "bigint unsigned",
          isNullable: "NO",
          columnDefault: "1",
          extra: "",
          generationExpression: "",
        });
        expect(await readMigrationJournalCount(pool)).toBe(1);
      });
    });

    it("fails before journaling a malformed preexisting generation", async () => {
      await withTestDatabase(async (pool) => {
        await pool.query(
          "CREATE TABLE `Form` (`id` varchar(191) PRIMARY KEY NOT NULL, `publicPasswordGrantGeneration` int NULL DEFAULT NULL)",
        );
        await pool.query(
          "INSERT INTO `Form` (`id`, `publicPasswordGrantGeneration`) VALUES ('existing-form', NULL)",
        );

        await expect(runMigration(pool)).rejects.toMatchObject({
          cause: { code: "ER_DUP_FIELDNAME" },
        });

        expect(await readColumnMetadata(pool)).toEqual({
          columnType: "int",
          isNullable: "YES",
          columnDefault: null,
          extra: "",
          generationExpression: "",
        });
        expect(await readMigrationJournalCount(pool)).toBe(0);
        const [rows] = await pool.query<GenerationRow[]>(
          "SELECT `publicPasswordGrantGeneration` AS generation FROM `Form` WHERE `id` = 'existing-form'",
        );
        expect(rows[0]?.generation).toBeNull();
      });
    });

    it("fails closed if breakpoint statements lose their MySQL session", async () => {
      await withTestDatabase(async (pool) => {
        await pool.query(
          "CREATE TABLE `Form` (`id` varchar(191) PRIMARY KEY NOT NULL)",
        );
        await pool.query(
          "CREATE TABLE `__drizzle_migrations` (`id` serial PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)",
        );
        const statements = readMigrationSql().split("--> statement-breakpoint");
        const decisionStatement = statements[0];
        const prepareStatement = statements[1];
        if (!decisionStatement || !prepareStatement) {
          throw new Error("Migration breakpoint statements must exist");
        }

        const sourceUrl = new URL(requireDatabaseUrl());
        const [databaseRows] = await pool.query<
          Array<RowDataPacket & { databaseName: string }>
        >("SELECT DATABASE() AS databaseName");
        const currentDatabase = databaseRows[0]?.databaseName;
        if (!currentDatabase) {
          throw new Error("Test database name must exist");
        }
        sourceUrl.pathname = `/${currentDatabase}`;
        const decisionConnection = await mysql.createConnection(
          sourceUrl.toString(),
        );
        const prepareConnection = await mysql.createConnection(
          sourceUrl.toString(),
        );
        try {
          await decisionConnection.query(decisionStatement);
          await expect(
            prepareConnection.query(prepareStatement),
          ).rejects.toMatchObject({ code: "ER_PARSE_ERROR" });
        } finally {
          await decisionConnection.end();
          await prepareConnection.end();
        }

        expect(await readMigrationJournalCount(pool)).toBe(0);
        const [columnRows] = await pool.query<CountRow[]>(
          `SELECT COUNT(*) AS count
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'Form'
            AND COLUMN_NAME = 'publicPasswordGrantGeneration'`,
        );
        expect(Number(columnRows[0]?.count ?? 0)).toBe(0);
      });
    });
  },
);
