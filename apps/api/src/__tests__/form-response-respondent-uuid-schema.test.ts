import { formResponse } from "@nexus-form/database/schema";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

describe("formResponse.respondentUuid constraints", () => {
  it("does not enforce a global unique constraint on respondentUuid", () => {
    const config = getTableConfig(formResponse);

    const globalRespondentUuidUnique = config.uniqueConstraints.find(
      (constraint) =>
        constraint.columns.length === 1 &&
        constraint.columns[0]?.name === "respondentUuid",
    );

    expect(globalRespondentUuidUnique).toBeUndefined();
  });

  it("keeps the formId + respondentUuid lookup index", () => {
    const config = getTableConfig(formResponse);

    const hasFormRespondentIndex = config.indexes.some(
      (index) => index.config.name === "FormResponse_formId_respondentUuid_idx",
    );

    expect(hasFormRespondentIndex).toBe(true);
  });
});
