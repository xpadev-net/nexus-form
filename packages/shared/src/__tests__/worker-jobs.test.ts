import { describe, expect, it } from "vitest";
import {
  buildValidationRetryJobId,
  genericValidationJobDataSchema,
  sanitizeValidationResultIdForRetryJob,
  sheetsSyncJobDataSchema,
  VALIDATION_RETRY_JOB_PREFIX,
} from "../worker-jobs";

describe("validation retry job ids", () => {
  it("uses a colon-free prefix and sanitizes result ids", () => {
    expect(VALIDATION_RETRY_JOB_PREFIX).toBe("validation-retry-");
    expect(VALIDATION_RETRY_JOB_PREFIX).not.toContain(":");

    const resultId = "validation-result:d7210b09421b8eb30c7a872f2e5b666a";
    expect(sanitizeValidationResultIdForRetryJob(resultId)).toBe(
      "validation-result-d7210b09421b8eb30c7a872f2e5b666a",
    );

    const jobId = buildValidationRetryJobId(resultId, "nonce-1");
    expect(jobId).toBe(
      "validation-retry-validation-result-d7210b09421b8eb30c7a872f2e5b666a-nonce-1",
    );
    expect(jobId).not.toContain(":");

    const jobIdWithColonNonce = buildValidationRetryJobId(
      resultId,
      "job:nonce",
    );
    expect(jobIdWithColonNonce).not.toContain(":");
    expect(jobIdWithColonNonce.endsWith("-job-nonce")).toBe(true);
  });
});

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
        snapshotVersion: 3,
      }),
    ).toEqual({
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "block-1",
      snapshotProviderName: "discord",
      snapshotRuleType: "member",
      snapshotConfigJson: { guildId: "guild-1" },
      snapshotVersion: 3,
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
