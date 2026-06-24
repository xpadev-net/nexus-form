import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formStructure } from "@nexus-form/database/schema";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

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

function readFormStructureConstraintMigration(): string {
  return readFileSync(
    resolve(
      findRepoRoot(process.cwd()),
      "packages/database/drizzle/0014_certain_speed_demon.sql",
    ),
    "utf8",
  );
}

describe("FormStructure database constraints", () => {
  it("declares unique constraints for form versions and active structure", () => {
    const config = getTableConfig(formStructure);

    expect(
      config.indexes.some(
        (index) => index.config.name === "FormStructure_formId_version_key",
      ),
    ).toBe(true);
    expect(
      config.indexes.some(
        (index) => index.config.name === "FormStructure_activeFormId_key",
      ),
    ).toBe(true);
  });

  it("normalizes existing rows before adding the unique constraints", () => {
    const sql = readFormStructureConstraintMigration();

    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain(
      "DROP TABLE IF EXISTS `FormStructureVersionRenumbering`",
    );
    expect(sql).toContain("CREATE TABLE `FormStructureVersionRenumbering`");
    expect(sql).toContain("PARTITION BY `formId`, `version`");
    expect(sql).toContain(
      "SET `Target`.`version` = `Renumbered`.`nextVersion`",
    );
    expect(sql).toContain(
      "DROP TABLE IF EXISTS `FormStructureActiveNormalization`",
    );
    expect(sql).toContain("CREATE TABLE `FormStructureActiveNormalization`");
    expect(sql).toContain("PARTITION BY `formId`");
    expect(sql).toContain("SET `Target`.`isActive` = false");
    expect(sql).toContain("`COLUMN_NAME` = 'activeFormId'");
    expect(sql).toContain(
      "'ALTER TABLE `FormStructure` ADD `activeFormId` varchar(128)'",
    );
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).toContain("SET `activeFormId` = CASE");
    expect(sql).toContain("WHEN `isActive` = true THEN `formId`");
    expect(sql).toContain("`INDEX_NAME` = 'FormStructure_formId_version_key'");
    expect(sql).toContain(
      "'CREATE UNIQUE INDEX `FormStructure_formId_version_key` ON `FormStructure` (`formId`,`version`)'",
    );
    expect(sql).toContain("`INDEX_NAME` = 'FormStructure_activeFormId_key'");
    expect(sql).toContain(
      "'CREATE UNIQUE INDEX `FormStructure_activeFormId_key` ON `FormStructure` (`activeFormId`)'",
    );
    expect(sql.indexOf("SET `Target`.`isActive` = false")).toBeLessThan(
      sql.indexOf("SET `activeFormId` = CASE"),
    );
    expect(sql.indexOf("SET `activeFormId` = CASE")).toBeLessThan(
      sql.indexOf("EXECUTE nf_create_active_form_id_index_stmt"),
    );
  });
});
