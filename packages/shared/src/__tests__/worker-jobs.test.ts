import { describe, expect, it } from "vitest";
import {
  buildAutoSheetsSyncJobId,
  buildManualSheetsSyncJobId,
  buildValidationRetryJobId,
  genericValidationJobDataSchema,
  SHEETS_SYNC_AUTO_JOB_PREFIX,
  SHEETS_SYNC_MANUAL_JOB_PREFIX,
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

describe("sheets sync job ids", () => {
  it("builds deterministic colon-free auto and manual job ids", () => {
    const autoJobId = buildAutoSheetsSyncJobId(
      "integration:one",
      "response:one",
    );
    const manualJobId = buildManualSheetsSyncJobId(
      "integration:one",
      "response:one",
      "retry:one",
    );

    expect(autoJobId).toBe(
      `${SHEETS_SYNC_AUTO_JOB_PREFIX}696e746567726174696f6e3a6f6e65.726573706f6e73653a6f6e65`,
    );
    expect(manualJobId).toBe(
      `${SHEETS_SYNC_MANUAL_JOB_PREFIX}696e746567726174696f6e3a6f6e65.726573706f6e73653a6f6e65.72657472793a6f6e65`,
    );
    expect(autoJobId).not.toContain(":");
    expect(manualJobId).not.toContain(":");
    expect(buildAutoSheetsSyncJobId("integration:one", "response:one")).toBe(
      autoJobId,
    );
    expect(
      buildManualSheetsSyncJobId(
        "integration:one",
        "response:one",
        "retry:one",
      ),
    ).toBe(manualJobId);
    expect(
      buildManualSheetsSyncJobId(
        "integration:one",
        "response:one",
        "retry:two",
      ),
    ).not.toBe(manualJobId);
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
