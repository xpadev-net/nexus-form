import { db } from "@nexus-form/database";
import {
  buildValidationOutboxJobId,
  buildValidationRetryJobId,
  buildValidationRevalidationJobId,
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

type MockValidationResultRow = {
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  errorCode: string | null;
  enqueueMode: "LEGACY" | "STABLE";
  jobId: string | null;
};

function resolveSqlOperand(
  token: unknown,
  row: MockValidationResultRow,
): unknown {
  switch (token) {
    case "responseId":
      return row.responseId;
    case "ruleId":
      return row.ruleId;
    case "referencedBlockId":
      return row.referencedBlockId;
    case "status":
      return row.status;
    case "errorCode":
      return row.errorCode;
    case "enqueueMode":
      return row.enqueueMode;
    case "jobId":
      return row.jobId;
    default:
      return token;
  }
}

function evaluateSqlCondition(
  condition: unknown,
  row: MockValidationResultRow,
): boolean {
  const tokens = flattenSqlChunks(condition).filter((token) => token !== "");
  let index = 0;

  const parsePrimary = (): boolean => {
    if (tokens[index] === "(") {
      index++;
      const result = parseOr();
      if (tokens[index] !== ")") {
        throw new Error("Expected closing parenthesis in SQL condition");
      }
      index++;
      return result;
    }

    const left = resolveSqlOperand(tokens[index++], row);
    const operator = tokens[index++];
    if (operator === " is null") {
      return left === null;
    }

    const right = resolveSqlOperand(tokens[index++], row);
    if (operator === " = ") {
      return left === right;
    }
    if (operator === " <> ") {
      return left !== right;
    }
    throw new Error(`Unsupported SQL operator: ${String(operator)}`);
  };

  const parseAnd = (): boolean => {
    let result = parsePrimary();
    while (tokens[index] === " and ") {
      index++;
      const right = parsePrimary();
      result = result && right;
    }
    return result;
  };

  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[index] === " or ") {
      index++;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };

  const result = parseOr();
  if (index !== tokens.length) {
    throw new Error("Unexpected trailing SQL condition tokens");
  }
  return result;
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
  transactionSelect,
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
  transactionSelect: vi.fn(),
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
        select: transactionSelect,
        update: vi.fn(() => ({
          set: updateSet,
        })),
      }),
    ),
  },
  externalServiceValidationResult: {
    enqueueMode: "enqueueMode",
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
  transactionSelect.mockReturnValue({ from: selectFrom });
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
  transactionSelect.mockClear();
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
  const validationParams = {
    responseId: "response-1",
    formId: "form-1",
    ruleId: "rule-1",
    referencedBlockId: "question-1",
    service: "discord",
  };
  const validationResultId = getValidationResultId(validationParams);
  const stableOutboxJobId = buildValidationOutboxJobId(validationResultId);
  const retryJobId = buildValidationRetryJobId(validationResultId, "job-a");
  const revalidationJobId = buildValidationRevalidationJobId(
    validationResultId,
    "job-a",
  );

  function makeValidationRow(
    overrides: Partial<MockValidationResultRow> = {},
  ): MockValidationResultRow {
    return {
      responseId: validationParams.responseId,
      ruleId: validationParams.ruleId,
      referencedBlockId: validationParams.referencedBlockId,
      status: "PENDING",
      errorCode: null,
      enqueueMode: "STABLE",
      jobId: null,
      ...overrides,
    };
  }

  function mockValidationRow(row: MockValidationResultRow | null): void {
    updateWhere.mockImplementationOnce(async (condition: unknown) => {
      if (row === null) {
        selectForUpdate.mockResolvedValueOnce([]);
        return [{ affectedRows: 0 }];
      }

      const matched = evaluateSqlCondition(condition, row);
      if (!matched) {
        selectForUpdate.mockResolvedValueOnce([row]);
      }
      return [{ affectedRows: matched ? 1 : 0 }];
    });
  }

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

  it.each([
    ["STABLE", "PENDING", "retry", retryJobId],
    ["STABLE", "PENDING", "revalidation", revalidationJobId],
    ["STABLE", "PROCESSING", "retry", retryJobId],
    ["STABLE", "PROCESSING", "revalidation", revalidationJobId],
    ["LEGACY", "PENDING", "retry", retryJobId],
    ["LEGACY", "PENDING", "revalidation", revalidationJobId],
    ["LEGACY", "PROCESSING", "retry", retryJobId],
    ["LEGACY", "PROCESSING", "revalidation", revalidationJobId],
  ] as const)("admits a %s %s row owned by the same strict %s job", async (enqueueMode, status, _jobType, jobId) => {
    mockValidationRow(makeValidationRow({ enqueueMode, jobId, status }));

    await markValidationProcessing({
      ...validationParams,
      jobId,
    });

    const updateCondition = flattenSqlChunks(updateWhere.mock.calls[0]?.[0]);
    expect(updateCondition).toEqual(
      expect.arrayContaining(["jobId", " = ", jobId]),
    );
    expect(updateCondition).not.toContain("enqueueMode");
    expect(selectForUpdate).not.toHaveBeenCalled();
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROCESSING" }),
    );
  });

  it.each([
    ["STABLE", "retry", retryJobId, null],
    ["STABLE", "retry", retryJobId, "different-job"],
    ["STABLE", "revalidation", revalidationJobId, null],
    ["STABLE", "revalidation", revalidationJobId, "different-job"],
    ["LEGACY", "retry", retryJobId, null],
    ["LEGACY", "retry", retryJobId, "different-job"],
    ["LEGACY", "revalidation", revalidationJobId, null],
    ["LEGACY", "revalidation", revalidationJobId, "different-job"],
  ] as const)("rejects a %s row not owned by the strict %s job", async (enqueueMode, _jobType, jobId, persistedJobId) => {
    mockValidationRow(
      makeValidationRow({ enqueueMode, jobId: persistedJobId }),
    );

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: jobId,
      actualJobId: persistedJobId,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["STABLE", "COMPLETED", "retry", retryJobId, null],
    ["STABLE", "FAILED", "retry", retryJobId, "VALIDATION_ERROR"],
    ["STABLE", "COMPLETED", "revalidation", revalidationJobId, null],
    ["STABLE", "FAILED", "revalidation", revalidationJobId, "VALIDATION_ERROR"],
    ["LEGACY", "COMPLETED", "retry", retryJobId, null],
    ["LEGACY", "FAILED", "retry", retryJobId, "VALIDATION_ERROR"],
    ["LEGACY", "COMPLETED", "revalidation", revalidationJobId, null],
    ["LEGACY", "FAILED", "revalidation", revalidationJobId, "VALIDATION_ERROR"],
  ] as const)("preserves %s %s behavior for a row owned by a strict %s job", async (enqueueMode, status, _jobType, jobId, errorCode) => {
    mockValidationRow(
      makeValidationRow({ enqueueMode, status, errorCode, jobId }),
    );

    await markValidationProcessing({
      ...validationParams,
      jobId,
    });

    expect(selectForUpdate).not.toHaveBeenCalled();
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROCESSING" }),
    );
  });

  it.each([
    ["STABLE", "retry", retryJobId, retryJobId],
    ["STABLE", "retry", retryJobId, "different-job"],
    ["STABLE", "revalidation", revalidationJobId, revalidationJobId],
    ["STABLE", "revalidation", revalidationJobId, null],
    ["LEGACY", "retry", retryJobId, retryJobId],
    ["LEGACY", "retry", retryJobId, "different-job"],
    ["LEGACY", "revalidation", revalidationJobId, revalidationJobId],
    ["LEGACY", "revalidation", revalidationJobId, null],
  ] as const)("preserves cancellation on a %s row before strict %s ownership diagnosis", async (enqueueMode, _jobType, jobId, persistedJobId) => {
    mockValidationRow(
      makeValidationRow({
        status: "FAILED",
        errorCode: "CANCELLED_BY_USER",
        enqueueMode,
        jobId: persistedJobId,
      }),
    );

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId,
      }),
    ).rejects.toBeInstanceOf(ValidationCancelledError);
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDING with a null job id", "PENDING", null],
    ["PENDING with the same job id", "PENDING", stableOutboxJobId],
    ["PROCESSING with the same job id", "PROCESSING", stableOutboxJobId],
  ])("admits a STABLE outbox row from %s", async (_case, status, jobId) => {
    mockValidationRow(
      makeValidationRow({
        status: status === "PROCESSING" ? "PROCESSING" : "PENDING",
        jobId,
      }),
    );

    await markValidationProcessing({
      ...validationParams,
      jobId: stableOutboxJobId,
    });

    expect(selectForUpdate).not.toHaveBeenCalled();
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROCESSING" }),
    );
  });

  it.each([
    "COMPLETED",
    "FAILED",
  ] as const)("rejects a STABLE outbox row in terminal state %s", async (status) => {
    mockValidationRow(
      makeValidationRow({
        status,
        errorCode: status === "FAILED" ? "VALIDATION_ERROR" : null,
        jobId: stableOutboxJobId,
      }),
    );

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId: stableOutboxJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: stableOutboxJobId,
      actualJobId: stableOutboxJobId,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing STABLE outbox row", async () => {
    mockValidationRow(null);

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId: stableOutboxJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: stableOutboxJobId,
      actualJobId: null,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it.each([
    "PENDING",
    "PROCESSING",
  ] as const)("rejects a STABLE %s row owned by a different job", async (status) => {
    mockValidationRow(
      makeValidationRow({
        status,
        jobId: "validation-outbox-newer-job",
      }),
    );

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId: stableOutboxJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: stableOutboxJobId,
      actualJobId: "validation-outbox-newer-job",
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("rejects a STABLE PROCESSING row with a null job id", async () => {
    mockValidationRow(makeValidationRow({ status: "PROCESSING" }));

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId: stableOutboxJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: stableOutboxJobId,
      actualJobId: null,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it("rejects a LEGACY row even when its job id matches a stable outbox job", async () => {
    mockValidationRow(
      makeValidationRow({
        enqueueMode: "LEGACY",
        jobId: stableOutboxJobId,
      }),
    );

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId: stableOutboxJobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: stableOutboxJobId,
      actualJobId: stableOutboxJobId,
    });
    expect(publishValidationEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["a forged outbox-prefix job id", "validation-outbox-forged"],
    ["an ordinary job id", "ordinary-job"],
  ])("rejects %s against a STABLE PENDING row with null job id", async (_case, jobId) => {
    mockValidationRow(makeValidationRow());

    await expect(
      markValidationProcessing({
        ...validationParams,
        jobId,
      }),
    ).rejects.toMatchObject({
      expectedJobId: jobId,
      actualJobId: null,
    });
    expect(transactionSelect).toHaveBeenCalledWith(
      expect.objectContaining({ enqueueMode: expect.anything() }),
    );
    expect(publishValidationEvent).not.toHaveBeenCalled();
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
