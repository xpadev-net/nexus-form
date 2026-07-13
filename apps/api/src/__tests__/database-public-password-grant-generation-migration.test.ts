import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { form } from "@nexus-form/database/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

const grantGenerationColumnSchema = z.object({
  name: z.literal("publicPasswordGrantGeneration"),
  type: z.literal("bigint unsigned"),
  notNull: z.literal(true),
  autoincrement: z.literal(false),
  default: z.union([z.literal("1"), z.literal(1)]),
});

const drizzleSnapshotSchema = z.object({
  tables: z.object({
    Form: z.object({
      columns: z.object({
        publicPasswordGrantGeneration: grantGenerationColumnSchema,
      }),
    }),
  }),
});

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

function readGrantGenerationMigration(): string {
  return readFileSync(
    resolve(
      findRepoRoot(process.cwd()),
      "packages/database/drizzle/0017_public_grant_generation.sql",
    ),
    "utf8",
  );
}

function readGrantGenerationColumn() {
  const snapshot = drizzleSnapshotSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(
          findRepoRoot(process.cwd()),
          "packages/database/drizzle/meta/0017_snapshot.json",
        ),
        "utf8",
      ),
    ),
  );
  return snapshot.tables.Form.columns.publicPasswordGrantGeneration;
}

describe("public password grant generation migration", () => {
  it("adds a precision-safe monotonic generation to fresh schema metadata", () => {
    expectTypeOf<
      typeof form.$inferSelect.publicPasswordGrantGeneration
    >().toEqualTypeOf<bigint>();
    expect(readGrantGenerationColumn()).toEqual({
      name: "publicPasswordGrantGeneration",
      type: "bigint unsigned",
      notNull: true,
      autoincrement: false,
      default: "1",
    });
  });

  it("backfills existing forms with a non-null additive default", () => {
    const sql = readGrantGenerationMigration();

    expect(sql).toContain(
      "ALTER TABLE `Form` ADD `publicPasswordGrantGeneration` bigint unsigned DEFAULT 1 NOT NULL",
    );
    expect(sql).not.toContain("UPDATE `Form`");
    expect(sql).not.toContain("MODIFY");
    expect(sql).not.toContain("DROP");
  });

  it("is restart-safe after the single auto-committing DDL boundary", () => {
    const sql = readGrantGenerationMigration();

    expect(sql).toContain("FROM `INFORMATION_SCHEMA`.`COLUMNS`");
    expect(sql).toContain("AND `TABLE_NAME` = 'Form'");
    expect(sql).toContain(
      "AND `COLUMN_NAME` = 'publicPasswordGrantGeneration'",
    );
    expect(sql).toContain(
      "@nf_public_password_grant_generation_exists > 0,\n  'SELECT 1'",
    );
    expect(sql).toContain(
      "PREPARE nf_add_public_password_grant_generation_stmt",
    );
    expect(sql).toContain(
      "DEALLOCATE PREPARE nf_add_public_password_grant_generation_stmt",
    );
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
  });
});
