import { describe, expect, it } from "vitest";
import {
  genericValidationJobDataSchema,
  sheetsSyncJobDataSchema,
} from "../worker-jobs";

describe("worker job schemas", () => {
  it("accepts valid generic validation job data", () => {
    expect(
      genericValidationJobDataSchema.parse({
        responseId: "response-1",
        ruleId: "rule-1",
        referencedBlockId: "block-1",
        snapshotProviderName: "discord",
        snapshotRuleType: "member",
        snapshotConfigJson: { guildId: "guild-1" },
      }),
    ).toEqual({
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "block-1",
      snapshotProviderName: "discord",
      snapshotRuleType: "member",
      snapshotConfigJson: { guildId: "guild-1" },
    });
  });

  it("rejects incomplete sheets sync job data", () => {
    expect(() =>
      sheetsSyncJobDataSchema.parse({
        formId: "form-1",
        integrationId: "integration-1",
      }),
    ).toThrow();
  });

  it("accepts a sheets sync job with a submitted snapshot version", () => {
    expect(
      sheetsSyncJobDataSchema.parse({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-1",
        snapshotVersion: 3,
      }),
    ).toEqual({
      formId: "form-1",
      integrationId: "integration-1",
      responseId: "response-1",
      snapshotVersion: 3,
    });
  });
});
