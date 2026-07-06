import { db } from "@nexus-form/database";
import {
  getValidationResultId,
  VALIDATION_RETRY_JOB_PREFIX,
  VALIDATION_REVALIDATION_JOB_PREFIX,
} from "@nexus-form/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractReferencedValueFromJson } from "../response-data-extractor";
import {
  ConcurrentDeleteError,
  FormResponseNotFoundError,
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  StaleValidationJobError,
  ValidationCancelledError,
  writeValidationResult,
} from "../validation-helpers";

function flattenSqlChunks(value: unknown): unknown[] {
  if (value === null || typeof value !== "object") {
    return [value];
  }

  const candidate = value as { queryChunks?: unknown[]; value?: unknown[] };
  if (Array.isArray(candidate.queryChunks)) {
    return candidate.queryChunks.flatMap(flattenSqlChunks);
  }
  if (Array.isArray(candidate.value)) {
    return candidate.value.flatMap(flattenSqlChunks);
  }
  return [value];
}

const {
  insertValues,
  onDuplicateKeyUpdate,
  publishValidationEvent,
  selectForUpdate,
  selectFrom,
  selectLeftJoin,
  selectLimit,
  selectOrderBy,
  selectWhere,
  updateSet,
  updateWhere,
} = vi.hoisted(() => ({
  insertValues: vi.fn(),
  onDuplicateKeyUpdate: vi.fn(),
  publishValidationEvent: vi.fn(),
  selectForUpdate: vi.fn(),
  selectFrom: vi.fn(),
  selectLeftJoin: vi.fn(),
  selectLimit: vi.fn(),
  selectOrderBy: vi.fn(),
  selectWhere: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    select: vi.fn(() => ({
      from: selectFrom,
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
    transaction: vi.fn(async (callback) =>
      callback({
        insert: vi.fn(() => ({
          values: insertValues,
        })),
        select: vi.fn(() => ({
          from: selectFrom,
        })),
        update: vi.fn(() => ({
          set: updateSet,
        })),
      }),
    ),
  },
  externalServiceValidationResult: {
    id: "id",
    responseId: "responseId",
    ruleId: "ruleId",
    referencedBlockId: "referencedBlockId",
    attemptCount: "attemptCount",
    errorCode: "errorCode",
    jobId: "jobId",
    status: "status",
  },
  formResponse: {
    id: "id",
    formId: "formId",
    responseDataJson: "responseDataJson",
  },
  formSnapshot: {
    formId: "formId",
    plateContent: "plateContent",
    isActive: "isActive",
    version: "version",
  },
}));

vi.mock("../redis-publisher", () => ({
  publishValidationEvent,
}));

beforeEach(() => {
  insertValues.mockReturnValue({ onDuplicateKeyUpdate });
  onDuplicateKeyUpdate.mockResolvedValue([{ affectedRows: 1 }]);
  selectFrom.mockReturnValue({ where: selectWhere, leftJoin: selectLeftJoin });
  selectLeftJoin.mockReturnValue({ where: selectWhere });
  selectWhere.mockReturnValue({
    limit: selectLimit,
    for: selectForUpdate,
    orderBy: selectOrderBy,
  });
  selectOrderBy.mockReturnValue({ limit: selectLimit });
  selectLimit.mockResolvedValue([]);
  selectForUpdate.mockResolvedValue([]);
  updateSet.mockReturnValue({ where: updateWhere });
  updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  publishValidationEvent.mockResolvedValue(undefined);
  vi.mocked(db.select).mockClear();
  vi.mocked(db.insert).mockClear();
  vi.mocked(db.update).mockClear();
  vi.mocked(db.transaction).mockClear();
  insertValues.mockClear();
  onDuplicateKeyUpdate.mockClear();
  selectForUpdate.mockClear();
  selectFrom.mockClear();
  selectLeftJoin.mockClear();
  selectWhere.mockClear();
  selectOrderBy.mockClear();
  selectLimit.mockClear();
  updateSet.mockClear();
  updateWhere.mockClear();
  publishValidationEvent.mockClear();
});

describe("getValidationResultId", () => {
  it("returns a stable id for the validation result unique key", () => {
    const params = {
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
    };

    expect(getValidationResultId(params)).toBe(getValidationResultId(params));
    expect(getValidationResultId(params)).toMatch(
      /^validation-result:[a-f0-9]{32}$/,
    );
  });

  it("changes when any unique key component changes", () => {
    const base = {
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
    };

    expect(getValidationResultId(base)).not.toBe(
      getValidationResultId({ ...base, referencedBlockId: "question-2" }),
    );
  });
});

describe("getValidationContext", () => {
  it("loads the response and latest snapshot with one select query", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "response-1",
        formId: "form-1",
        responseDataJson: JSON.stringify([
          {
            question_id: "question-1",
            question_type: "short_text",
            value: "hello",
          },
        ]),
        submittedAt: new Date("2026-05-20T00:00:00.000Z"),
        updatedAt: null,
        respondentUuid: "respondent-1",
        userAgent: null,
        sessionId: null,
        countryCode: null,
        snapshotPlateContent: JSON.stringify([
          {
            type: "form_short_text",
            blockId: "question-1",
            children: [{ text: "Question 1" }],
          },
        ]),
      },
    ]);

    const context = await getValidationContext(
      "response-1",
      "rule-1",
      "question-1",
    );

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectLeftJoin).toHaveBeenCalled();
    expect(selectOrderBy).toHaveBeenCalled();
    expect(context.response.formId).toBe("form-1");
    expect(context.referencedValue).toBe("hello");
  });

  it("pins block existence checks to the submitted snapshot version when provided", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "response-1",
        formId: "form-1",
        responseDataJson: JSON.stringify([
          {
            question_id: "question-1",
            question_type: "short_text",
            value: "hello",
          },
        ]),
        submittedAt: new Date("2026-05-20T00:00:00.000Z"),
        updatedAt: null,
        respondentUuid: "respondent-1",
        userAgent: null,
        sessionId: null,
        countryCode: null,
        snapshotPlateContent: JSON.stringify([
          {
            type: "form_short_text",
            blockId: "question-1",
            children: [{ text: "Question 1" }],
          },
        ]),
      },
    ]);

    await getValidationContext("response-1", "rule-1", "question-1", 3);

    const joinCondition = selectLeftJoin.mock.calls[0]?.[1];
    expect(flattenSqlChunks(joinCondition)).toEqual(
      expect.arrayContaining(["version", 3]),
    );
  });

  it("falls back to the latest snapshot when the submitted snapshot was deleted", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: JSON.stringify([
            {
              question_id: "question-1",
              question_type: "short_text",
              value: "hello",
            },
          ]),
          submittedAt: new Date("2026-05-20T00:00:00.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: null,
          countryCode: null,
          snapshotPlateContent: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          plateContent: JSON.stringify([
            {
              type: "form_short_text",
              blockId: "question-1",
              children: [{ text: "Question 1" }],
            },
          ]),
        },
      ]);

    const context = await getValidationContext(
      "response-1",
      "rule-1",
      "question-1",
      3,
    );

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(context.referencedValue).toBe("hello");
  });

  it("preserves the missing-block error when a response has no snapshot row", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "response-1",
        formId: "form-1",
        responseDataJson: JSON.stringify([
          {
            question_id: "question-1",
            question_type: "short_text",
            value: "hello",
          },
        ]),
        submittedAt: new Date("2026-05-20T00:00:00.000Z"),
        updatedAt: null,
        respondentUuid: "respondent-1",
        userAgent: null,
        sessionId: null,
        countryCode: null,
        snapshotPlateContent: null,
      },
    ]);

    await expect(
      getValidationContext("response-1", "rule-1", "question-1"),
    ).rejects.toBeInstanceOf(ReferencedBlockMissingError);
  });

  it("throws when the response row is missing", async () => {
    selectLimit.mockResolvedValueOnce([]);

    await expect(
      getValidationContext("missing-response", "rule-1", "question-1"),
    ).rejects.toBeInstanceOf(FormResponseNotFoundError);
  });
});

describe("writeValidationResult", () => {
  it("returns the deterministic result id after locked upsert", async () => {
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      success: true,
      metadata: { ok: true },
      jobId: "job-1",
    };
    const expectedId = getValidationResultId(params);

    const resultId = await writeValidationResult(params);

    expect(resultId).toBe(expectedId);
    expect(db.transaction).toHaveBeenCalled();
    expect(selectForUpdate).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expectedId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
      }),
    );
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: expect.objectContaining({
        id: expectedId,
        status: "COMPLETED",
        success: true,
      }),
    });
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        validationResultId: expectedId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
        status: "COMPLETED",
      }),
    );
  });

  it("does not overwrite a validation result cancelled by the user", async () => {
    selectForUpdate.mockResolvedValueOnce([
      { status: "FAILED", errorCode: "CANCELLED_BY_USER" },
    ]);
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      success: true,
      jobId: "job-1",
    };
    const expectedId = getValidationResultId(params);

    const resultId = await writeValidationResult(params);

    expect(resultId).toBe(expectedId);
    expect(insertValues).not.toHaveBeenCalled();
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("can overwrite a non-cancelled failed validation result for retry completion", async () => {
    selectForUpdate.mockResolvedValueOnce([
      { status: "FAILED", errorCode: "VALIDATION_ERROR" },
    ]);
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      success: true,
      jobId: "job-1",
    };

    await writeValidationResult(params);

    expect(insertValues).toHaveBeenCalled();
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMPLETED" }),
    );
  });

  it("does not overwrite or publish when the current row belongs to a newer job", async () => {
    selectForUpdate.mockResolvedValueOnce([
      { status: "PENDING", errorCode: null, jobId: "job-b" },
    ]);
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      success: true,
      jobId: "job-a",
    };

    await writeValidationResult(params);

    expect(insertValues).not.toHaveBeenCalled();
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("does not overwrite an owned row when the worker job id is missing", async () => {
    selectForUpdate.mockResolvedValueOnce([
      { status: "PENDING", errorCode: null, jobId: "job-b" },
    ]);
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      success: true,
    };

    await writeValidationResult(params);

    expect(insertValues).not.toHaveBeenCalled();
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });
});

describe("markValidationProcessing", () => {
  it("rewrites existing rows to the deterministic result id before publishing PROCESSING", async () => {
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      jobId: "job-1",
    };
    const expectedId = getValidationResultId(params);

    await markValidationProcessing(params);

    expect(db.select).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({
      id: expectedId,
      jobId: "job-1",
      status: "PROCESSING",
    });
    expect(flattenSqlChunks(updateWhere.mock.calls[0]?.[0])).toEqual(
      expect.arrayContaining(["jobId", " is null", "job-1"]),
    );
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        validationResultId: expectedId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
        status: "PROCESSING",
      }),
    );
  });

  it("requires retry jobs to match the persisted job id before PROCESSING", async () => {
    const retryJobId = `${VALIDATION_RETRY_JOB_PREFIX}result-1-job-a`;

    await markValidationProcessing({
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      jobId: retryJobId,
    });

    const updateCondition = flattenSqlChunks(updateWhere.mock.calls[0]?.[0]);
    expect(updateCondition).toEqual(
      expect.arrayContaining(["jobId", " = ", retryJobId]),
    );
    expect(updateCondition).not.toContain(" is null");
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROCESSING" }),
    );
  });

  it("throws ConcurrentDeleteError when the processing row disappears before update", async () => {
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
      }),
    ).rejects.toBeInstanceOf(ConcurrentDeleteError);
  });

  it("throws before publishing when a cancelled row is excluded from PROCESSING", async () => {
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);
    selectForUpdate.mockResolvedValueOnce([
      { status: "FAILED", errorCode: "CANCELLED_BY_USER" },
    ]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
      }),
    ).rejects.toBeInstanceOf(ValidationCancelledError);
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("throws before publishing when a newer job owns the validation result", async () => {
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);
    selectForUpdate.mockResolvedValueOnce([
      { status: "PENDING", errorCode: null, jobId: "job-b" },
    ]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
        jobId: "job-a",
      }),
    ).rejects.toBeInstanceOf(StaleValidationJobError);
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("throws before publishing when a retry job starts before its job id is persisted", async () => {
    const retryJobId = `${VALIDATION_RETRY_JOB_PREFIX}result-1-job-a`;
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);
    selectForUpdate.mockResolvedValueOnce([
      { status: "PENDING", errorCode: null, jobId: null },
    ]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
        jobId: retryJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: retryJobId,
      actualJobId: null,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("throws before publishing when a revalidation job starts before its job id is persisted", async () => {
    const revalidationJobId = `${VALIDATION_REVALIDATION_JOB_PREFIX}result-1-job-a`;
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);
    selectForUpdate.mockResolvedValueOnce([
      { status: "PENDING", errorCode: null, jobId: null },
    ]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
        jobId: revalidationJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: revalidationJobId,
      actualJobId: null,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("throws before publishing when the worker job id is missing but the row is owned", async () => {
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);
    selectForUpdate.mockResolvedValueOnce([
      { status: "PENDING", errorCode: null, jobId: "job-b" },
    ]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
      }),
    ).rejects.toBeInstanceOf(StaleValidationJobError);
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("keeps non-cancelled failed rows eligible for retry processing", async () => {
    await markValidationProcessing({
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
    });

    expect(updateWhere).toHaveBeenCalled();
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROCESSING" }),
    );
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson — array format (new)
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson (array format)", () => {
  it("extracts value from valid array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("hello");
  });

  it("extracts checkbox values from array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "b"],
      },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("a,b");
  });

  it("throws when array items fail schema validation (e.g. numeric question_id)", () => {
    const json = JSON.stringify([
      { question_id: 123, question_type: "radio", value: "opt-a" },
    ]);
    expect(() => extractReferencedValueFromJson(json, "123", "resp-1")).toThrow(
      "responseDataJson array items failed schema validation for response resp-1",
    );
  });

  it("throws when block not found in array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      },
    ]);
    expect(() =>
      extractReferencedValueFromJson(json, "q999", "resp-1"),
    ).toThrow("Referenced block value not found: q999");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson — error cases
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson (error cases)", () => {
  it("throws for malformed JSON", () => {
    expect(() =>
      extractReferencedValueFromJson("{invalid", "q1", "resp-1"),
    ).toThrow("responseDataJson is not valid JSON for response resp-1");
  });

  it("throws when rawData is not an array", () => {
    const json = JSON.stringify({ q1: "value" });
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for non-object, non-array rawData (string)", () => {
    const json = JSON.stringify("just a string");
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for non-object, non-array rawData (number)", () => {
    const json = JSON.stringify(42);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for null rawData", () => {
    const json = JSON.stringify(null);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });
});
