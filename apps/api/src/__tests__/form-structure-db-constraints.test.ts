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
      "CREATE TEMPORARY TABLE `FormStructureVersionRenumbering`",
    );
    expect(sql).toContain("PARTITION BY `formId`, `version`");
    expect(sql).toContain(
      "SET `Target`.`version` = `Renumbered`.`nextVersion`",
    );
    expect(sql).toContain(
      "CREATE TEMPORARY TABLE `FormStructureActiveNormalization`",
    );
    expect(sql).toContain("PARTITION BY `formId`");
    expect(sql).toContain("SET `Target`.`isActive` = false");
    expect(sql).toContain(
      "ADD CONSTRAINT `FormStructure_formId_version_key` UNIQUE(`formId`,`version`)",
    );
    expect(sql).toContain(
      "ADD CONSTRAINT `FormStructure_activeFormId_key` UNIQUE(`activeFormId`)",
    );
  });
});
