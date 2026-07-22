import { type Job, UnrecoverableError } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shutdownSignalMock = await vi.hoisted(async () => {
  const { createShutdownSignalMock } = await import(
    "../../lib/__tests__/test-helpers/shutdown-signal-mock"
  );
  return createShutdownSignalMock();
});

vi.mock("@nexus-form/database", () => ({
  db: { select: vi.fn() },
  formIntegration: {
    id: "formIntegration.id",
    formId: "formIntegration.formId",
  },
  formResponse: {
    id: "formResponse.id",
    formId: "formResponse.formId",
    submittedAt: "formResponse.submittedAt",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {
    responseId: "externalServiceValidationResult.responseId",
    ruleId: "externalServiceValidationResult.ruleId",
    metadata: "externalServiceValidationResult.metadata",
    service: "externalServiceValidationResult.service",
    status: "externalServiceValidationResult.status",
    updatedAt: "externalServiceValidationResult.updatedAt",
    createdAt: "externalServiceValidationResult.createdAt",
  },
  fingerprintDetail: {
    componentName: "fingerprintDetail.componentName",
    componentValueHash: "fingerprintDetail.componentValueHash",
    fingerprintType: "fingerprintDetail.fingerprintType",
    responseId: "fingerprintDetail.responseId",
  },
  form: {
    plateContent: "form.plateContent",
  },
  formSnapshot: {
    plateContent: "formSnapshot.plateContent",
    structureJson: "formSnapshot.structureJson",
  },
  formStructure: {
    formId: "formStructure.formId",
    isActive: "formStructure.isActive",
    structureJson: "formStructure.structureJson",
    version: "formStructure.version",
  },
  formValidationRule: {
    id: "formValidationRule.id",
    name: "formValidationRule.name",
    providerName: "formValidationRule.providerName",
    ruleType: "formValidationRule.ruleType",
  },
}));

vi.mock("@nexus-form/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus-form/shared")>();
  const responseExport = await import(
    "../../../../../packages/shared/src/response-export"
  );
  return {
    ...actual,
    denormalizeSpreadsheetFormulaValue:
      responseExport.denormalizeSpreadsheetFormulaValue,
    groupResponseExportValidationOutputsByResponseId:
      responseExport.groupResponseExportValidationOutputsByResponseId,
    mapRecordToSheetRow: responseExport.mapRecordToSheetRow,
    neutralizeSpreadsheetFormulaValue:
      responseExport.neutralizeSpreadsheetFormulaValue,
    extractQuestionsFromPlateContent: vi.fn().mockReturnValue([]),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
  asc: vi.fn((column: unknown) => ({ column, direction: "asc" })),
  desc: vi.fn((column: unknown) => ({ column, direction: "desc" })),
  eq: vi.fn((column: unknown, value: unknown) => ({
    column,
    type: "eq",
    value,
  })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({
    column,
    type: "inArray",
    values,
  })),
}));

vi.mock("../../lib/google-sheets-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/google-sheets-client")>();
  return {
    ...actual,
    appendRows: vi.fn(),
    clearSheet: vi.fn(),
    readRange: vi.fn(),
    updateRange: vi.fn(),
  };
});

vi.mock("../../lib/oauth-token-store", () => ({
  getOAuthToken: vi.fn(),
  isOAuthRefreshPermanentAuthError: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock("../../lib/redis-lock", () => ({
  deleteIdempotencyKey: vi.fn(),
  getIdempotencyKeyValue: vi.fn(),
  getIdempotencyKeyTtlMs: vi.fn(),
  setIdempotencyKey: vi.fn(),
  withRedisLock: vi.fn(),
}));

vi.mock("../../lib/response-data-extractor", () => ({
  safeParseResponseData: vi.fn(),
}));

vi.mock("../../lib/shutdown-signal", () => ({
  workerShutdownSignal: shutdownSignalMock.signal,
}));

import { db, formIntegration, formResponse } from "@nexus-form/database";
import {
  extractQuestionsFromPlateContent,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { and } from "drizzle-orm";
import {
  appendRows,
  clearSheet,
  readRange,
  SHEETS_API_TIMEOUT_MS,
  updateRange,
} from "../../lib/google-sheets-client";
import {
  getOAuthToken,
  isOAuthRefreshPermanentAuthError,
  refreshTokenIfNeeded,
} from "../../lib/oauth-token-store";
import {
  deleteIdempotencyKey,
  getIdempotencyKeyTtlMs,
  getIdempotencyKeyValue,
  setIdempotencyKey,
  withRedisLock,
} from "../../lib/redis-lock";
import { safeParseResponseData } from "../../lib/response-data-extractor";
import {
  DONE_IDEMPOTENCY_TTL_SECONDS,
  handleSheetsSync,
  PENDING_IDEMPOTENCY_TTL_SECONDS,
  SHEETS_SYNC_LOCK_TTL_MS,
  SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS,
} from "../sheets-sync";

const mockDb = vi.mocked(db);
const mockAnd = vi.mocked(and);
const mockExtractQuestionsFromPlateContent = vi.mocked(
  extractQuestionsFromPlateContent,
);
const mockGetIdempotencyKeyValue = vi.mocked(getIdempotencyKeyValue);
const mockGetIdempotencyKeyTtlMs = vi.mocked(getIdempotencyKeyTtlMs);
const mockSetIdempotencyKey = vi.mocked(setIdempotencyKey);
const mockWithRedisLock = vi.mocked(withRedisLock);
const mockGetOAuthToken = vi.mocked(getOAuthToken);
const mockIsOAuthRefreshPermanentAuthError = vi.mocked(
  isOAuthRefreshPermanentAuthError,
);
const mockRefreshTokenIfNeeded = vi.mocked(refreshTokenIfNeeded);
const mockReadRange = vi.mocked(readRange);
const mockUpdateRange = vi.mocked(updateRange);
const mockAppendRows = vi.mocked(appendRows);
const mockClearSheet = vi.mocked(clearSheet);
const mockDeleteIdempotencyKey = vi.mocked(deleteIdempotencyKey);
const mockSafeParseResponseData = vi.mocked(safeParseResponseData);

const INTEGRATION = {
  id: "integration-1",
  configJson: JSON.stringify({
    spreadsheetId: "spreadsheet-id",
    sheetName: "Sheet1",
  }),
  userId: "user-1",
  ownerUserId: null,
};
const RESPONSE = {
  id: "response-1",
  responseDataJson: '{"block-1":"hello"}',
  formId: "form-1",
};
const TOKEN = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: null,
};

function makeJob(
  data: {
    formId: string;
    integrationId: string;
    mode?: "incremental" | "full";
    responseId: string;
    snapshotVersion?: number;
  } = {
    formId: "form-1",
    integrationId: "integration-1",
    responseId: "response-1",
  },
): Job {
  return {
    id: "job-1",
    data,
    discard: vi.fn(),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

/** Make db.select() return results in call order. */
function setupDbSelect(...results: unknown[][]) {
  let call = 0;
  mockDb.select.mockImplementation(() => {
    const idx = call++;
    const result = results[idx] ?? [];
    const promise = Promise.resolve(result);
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(result),
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable, and this mock must support direct await.
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    } as unknown as ReturnType<typeof db.select>;
  });
}

function setupHappyPathMocks() {
  // DB: integration → response → form (no plateContent)
  setupDbSelect([INTEGRATION], [RESPONSE], []);

  mockGetOAuthToken.mockResolvedValue(TOKEN as never);
  mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);

  // withRedisLock passes through to fn
  mockWithRedisLock.mockImplementation(async (_key, fn) => fn());

  mockGetIdempotencyKeyValue.mockResolvedValue(null);
  mockGetIdempotencyKeyTtlMs.mockResolvedValue(0);
  mockSetIdempotencyKey.mockResolvedValue(undefined);

  mockReadRange.mockResolvedValue({
    ok: true,
    data: { values: [["Response ID", "block-1"]] },
  } as never);

  mockSafeParseResponseData.mockReturnValue({ "block-1": "hello" } as never);

  mockUpdateRange.mockResolvedValue({ ok: true } as never);

  mockAppendRows.mockResolvedValue({
    ok: true,
    data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
  } as never);

  mockClearSheet.mockResolvedValue({
    ok: true,
    data: { clearedRange: "Sheet1!A1:Z1000000" },
  } as never);
  mockDeleteIdempotencyKey.mockResolvedValue(undefined);
}

function getInvocationCallOrder(
  mock: { mock: { invocationCallOrder: number[] } },
  index: number,
): number {
  const callOrder = mock.mock.invocationCallOrder[index];
  if (callOrder === undefined) {
    throw new Error(`Expected invocation call order at index ${index}`);
  }
  return callOrder;
}

function getFirstUpdateValues(): string[][] {
  const firstUpdate = mockUpdateRange.mock.calls[0];
  if (!firstUpdate) {
    throw new Error("Expected updateRange to be called");
  }
  return firstUpdate[1].values;
}

function getUpdateRow(values: string[][], index: number): string[] {
  const row = values[index];
  if (!row) {
    throw new Error(`Expected updateRange values row ${index}`);
  }
  return row;
}

beforeEach(() => {
  shutdownSignalMock.reset();
  vi.clearAllMocks();
  mockExtractQuestionsFromPlateContent.mockReturnValue([]);
  mockIsOAuthRefreshPermanentAuthError.mockReturnValue(false);
});

describe("handleSheetsSync — idempotency states", () => {
  it("job.data が不正な形状の場合はDBアクセス前に弾く", async () => {
    await expect(
      handleSheetsSync({
        id: "job-1",
        data: { formId: "form-1", integrationId: "integration-1" },
        updateProgress: vi.fn(),
      } as unknown as Job),
    ).rejects.toThrow();

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it.each([
    "null",
    "42",
    "[]",
  ])("configJson が object でない場合は弾く (%s)", async (configJson) => {
    setupDbSelect([{ ...INTEGRATION, configJson }]);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "Form integration configJson must be an object",
    );
    expect(mockGetOAuthToken).not.toHaveBeenCalled();
  });

  it("googleSheets config が object でない場合は弾く", async () => {
    setupDbSelect([
      {
        ...INTEGRATION,
        configJson: JSON.stringify({ googleSheets: "spreadsheet-id" }),
      },
    ]);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "Google Sheets integration setting must be an object",
    );
    expect(mockGetOAuthToken).not.toHaveBeenCalled();
  });

  it("integration が job の formId に属さない場合はSheets API呼び出し前に失敗する", async () => {
    setupDbSelect([]);

    await expect(
      handleSheetsSync(
        makeJob({
          formId: "form-2",
          integrationId: "integration-1",
          responseId: "response-1",
        }),
      ),
    ).rejects.toThrow("Form integration not found: integration-1");

    expect(mockAnd).toHaveBeenCalledWith(
      { column: formIntegration.id, type: "eq", value: "integration-1" },
      { column: formIntegration.formId, type: "eq", value: "form-2" },
    );
    expect(mockGetOAuthToken).not.toHaveBeenCalled();
    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it("deleted or cross-form response rows are excluded before any Sheets write", async () => {
    setupDbSelect([INTEGRATION], []);
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);

    await expect(
      handleSheetsSync(
        makeJob({
          formId: "form-2",
          integrationId: "integration-1",
          responseId: "response-1",
        }),
      ),
    ).rejects.toThrow("Form response not found: response-1");

    expect(mockAnd).toHaveBeenCalledWith(
      { column: formResponse.id, type: "eq", value: "response-1" },
      { column: formResponse.formId, type: "eq", value: "form-2" },
    );
    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it("throws UnrecoverableError when the OAuth token is missing", async () => {
    setupDbSelect([INTEGRATION]);
    mockGetOAuthToken.mockResolvedValue(null);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow("AUTH_REQUIRED: OAuth token not found");
    expect(job.discard).not.toHaveBeenCalled();

    expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled();
    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it("throws UnrecoverableError when OAuth token refresh requires reauthorization", async () => {
    setupDbSelect([INTEGRATION]);
    const refreshError = new Error(
      "Google OAuth refresh requires reauthorization (invalid_grant, HTTP 400)",
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockRejectedValue(refreshError);
    mockIsOAuthRefreshPermanentAuthError.mockReturnValue(true);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow(
      "AUTH_REQUIRED: OAuth token refresh failed: Google OAuth refresh requires reauthorization (invalid_grant, HTTP 400)",
    );
    expect(job.discard).not.toHaveBeenCalled();

    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it("keeps retryable OAuth token refresh failures retryable", async () => {
    setupDbSelect([INTEGRATION]);
    const refreshError = new Error("Google token refresh failed: 503");
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockRejectedValue(refreshError);

    let caught: unknown;
    try {
      await handleSheetsSync(makeJob());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(refreshError);
    expect(caught).not.toBeInstanceOf(UnrecoverableError);
    expect(mockIsOAuthRefreshPermanentAuthError).toHaveBeenCalledWith(
      refreshError,
    );
    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it('returns {skipped, reason:"duplicate"} when idempotency key is "done"', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue("done");

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).not.toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalledTimes(6);
  });

  it('waits out a stale "pending" idempotency key under the integration lock and writes without BullMQ retry', async () => {
    setupHappyPathMocks();
    let lockReleased = false;
    mockWithRedisLock.mockImplementationOnce(async (_key, fn) => {
      const result = await fn();
      lockReleased = true;
      return result;
    });
    mockGetIdempotencyKeyValue
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce(null);
    mockReadRange.mockResolvedValueOnce({
      ok: true,
      data: { values: [["Response ID", "block-1"]] },
    } as never);
    mockAppendRows.mockImplementationOnce(async () => {
      expect(lockReleased).toBe(false);
      return {
        ok: true,
        data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
      } as never;
    });

    const result = await handleSheetsSync(makeJob());

    expect(result).toMatchObject({
      ok: true,
      provider: "google-sheets",
      updatedRows: 1,
    });
    expect(mockAppendRows).toHaveBeenCalledOnce();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
    expect(mockWithRedisLock).toHaveBeenCalledTimes(1);
    expect(lockReleased).toBe(true);
  });

  it('does not poll Google Sheets while the "pending" idempotency key is still live', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce(null);
    mockGetIdempotencyKeyTtlMs
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const result = await handleSheetsSync(makeJob());

    expect(result).toMatchObject({
      ok: true,
      provider: "google-sheets",
      updatedRows: 1,
    });
    expect(mockGetIdempotencyKeyTtlMs).toHaveBeenCalledTimes(2);
    expect(mockReadRange).toHaveBeenCalledTimes(2);
    expect(mockAppendRows).toHaveBeenCalledOnce();
    expect(mockWithRedisLock).toHaveBeenCalledTimes(1);
  });

  it('returns duplicate without reading Sheets when a live "pending" key becomes "done"', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("done");
    mockGetIdempotencyKeyTtlMs.mockResolvedValueOnce(1);

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockGetIdempotencyKeyTtlMs).toHaveBeenCalledOnce();
    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).not.toHaveBeenCalled();
    expect(mockWithRedisLock).toHaveBeenCalledOnce();
  });

  it('fails closed when the expired "pending" idempotency sheet check fails', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce(null);
    mockReadRange.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal", message: "Sheets unavailable" },
    } as never);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "Failed to read sheet for idempotency check",
    );
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
  });

  it('discards and throws when the expired "pending" idempotency sheet check requires auth', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce(null);
    mockReadRange.mockResolvedValueOnce({
      ok: false,
      error: { code: "unauthorized", message: "invalid credentials" },
    } as never);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow(
      "AUTH_REQUIRED: read sheet for idempotency check: invalid credentials",
    );
    expect(job.discard).not.toHaveBeenCalled();

    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
  });

  it('promotes "pending" to "done" when the response row already exists', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce(null);
    // First readRange call: header row (range !1:1)
    // Second readRange call: responseId column (range !A:A) — column A = "Response ID"
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID", "block-1"]],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["response-1"], ["other-response"]],
        },
      } as never);

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    );
    expect(mockReadRange).toHaveBeenCalledTimes(2);
    expect(mockReadRange).toHaveBeenNthCalledWith(1, TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:2",
    });
    expect(mockReadRange).toHaveBeenNthCalledWith(2, TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!A:A",
    });
    expect(mockDb.select).toHaveBeenCalledTimes(6);
  });

  it("skips append when the idempotency key expired but the response row already exists", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    // First readRange call: header row (range !1:1)
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID", "block-1"]],
        },
      } as never)
      // Second readRange call: responseId column (range !A:A)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["response-1"], ["other-response"]],
        },
      } as never);

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledTimes(2);
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    );
    expect(mockReadRange).toHaveBeenCalledTimes(2);
    expect(mockReadRange).toHaveBeenNthCalledWith(1, TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:2",
    });
    expect(mockReadRange).toHaveBeenNthCalledWith(2, TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!A:A",
    });
    expect(getInvocationCallOrder(mockSetIdempotencyKey, 0)).toBeLessThan(
      getInvocationCallOrder(mockReadRange, 0),
    );
  });

  it("detects duplicate rows when a formula-like response ID was neutralized in Sheets", async () => {
    setupHappyPathMocks();
    setupDbSelect([INTEGRATION], [{ ...RESPONSE, id: "=response-1" }], []);
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [
            [
              "Response ID",
              "Respondent UUID",
              "Submitted At",
              "Updated At",
              "Country Code",
              "UA UUID",
              "Uniqueness Score",
              "block-1",
            ],
            [
              "回答ID",
              "回答者UUID",
              "送信日時",
              "更新日時",
              "国コード",
              "UA UUID",
              "ユニーク度スコア",
              "block-1",
            ],
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["回答ID"], ["'=response-1"]],
        },
      } as never);

    const result = await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "=response-1",
      }),
    );

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:=response-1",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    );
  });

  it("fails closed when the pre-append idempotency sheet check fails", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal", message: "Sheets unavailable" },
    } as never);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "Failed to read sheet for idempotency check",
    );
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
  });

  it("pending idempotency key 設定後の shutdown AbortError は Sheets を読まずに再スローする", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockImplementationOnce(async () => {
      shutdownSignalMock.abort(
        new DOMException("Worker shutdown", "AbortError"),
      );
    });

    await expect(handleSheetsSync(makeJob())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
    expect(mockReadRange).not.toHaveBeenCalled();
    expect(mockUpdateRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it("fails closed when the idempotency column read fails after header succeeds", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    // First call (header !1:1): succeeds, responseId at column 0
    mockReadRange.mockResolvedValueOnce({
      ok: true,
      data: { values: [["Response ID", "block-1"]] },
    } as never);
    // Second call (column !A:A): fails
    mockReadRange.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal", message: "Column unavailable" },
    } as never);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "Failed to read sheet column for idempotency check",
    );
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );
  });

  it("writes the row and promotes key to done when idempotency key is null", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);

    const result = await handleSheetsSync(makeJob());

    expect(result).toMatchObject({
      ok: true,
      provider: "google-sheets",
      jobId: "job-1",
      updatedRange: "Sheet1!A2",
      updatedRows: 1,
    });
    expect(mockAppendRows).toHaveBeenCalledOnce();

    // "pending" must be set before any Sheets API call in the write path.
    const [firstCall, secondCall] = mockSetIdempotencyKey.mock.calls;
    expect(firstCall).toEqual([
      "sheets-written:integration-1:response-1",
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    ]);
    // "done" must be set AFTER appendRows (second setIdempotencyKey call)
    expect(secondCall).toEqual([
      "sheets-written:integration-1:response-1",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    ]);
    // Verify ordering: pending → read sheet → appendRows → done
    expect(getInvocationCallOrder(mockSetIdempotencyKey, 0)).toBeLessThan(
      getInvocationCallOrder(mockReadRange, 0),
    );
    expect(getInvocationCallOrder(mockReadRange, 0)).toBeLessThan(
      getInvocationCallOrder(mockAppendRows, 0),
    );
    expect(getInvocationCallOrder(mockAppendRows, 0)).toBeLessThan(
      getInvocationCallOrder(mockSetIdempotencyKey, 1),
    );
  });

  it("writes the calculated uniqueness score into the sheet row", async () => {
    setupDbSelect(
      [INTEGRATION],
      [RESPONSE],
      [],
      [{ id: "response-1" }, { id: "response-2" }],
      [
        {
          responseId: "response-1",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
        {
          responseId: "response-2",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
      ],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [["Response ID", "block-1"]] },
    } as never);
    mockSafeParseResponseData.mockReturnValue({ "block-1": "hello" } as never);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        values: [["Response ID", "block-1", "ユニーク度スコア"]],
      }),
    );
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-1", "hello", "0.0000"]],
      }),
    );
  });

  it("updates existing sheet rows with recalculated uniqueness scores before appending", async () => {
    setupDbSelect(
      [INTEGRATION],
      [{ ...RESPONSE, id: "response-2" }],
      [],
      [{ id: "response-1" }, { id: "response-2" }],
      [
        {
          responseId: "response-1",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
        {
          responseId: "response-2",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
      ],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID", "ユニーク度スコア", "block-1"]],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["response-1"], ["missing-response"]],
        },
      } as never);
    mockSafeParseResponseData.mockReturnValue({ "block-1": "hello" } as never);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-2",
      }),
    );

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!B2:B2",
      values: [["0.0000"]],
    });
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-2", "0.0000", "hello"]],
      }),
    );
  });

  it("updates existing sheet score rows when formula-like response IDs were neutralized", async () => {
    setupDbSelect(
      [INTEGRATION],
      [{ ...RESPONSE, id: "response-2" }],
      [],
      [{ id: "=response-1" }, { id: "response-2" }],
      [
        {
          responseId: "=response-1",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
        {
          responseId: "response-2",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
      ],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID", "ユニーク度スコア", "block-1"]],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["'=response-1"], ["missing-response"]],
        },
      } as never);
    mockSafeParseResponseData.mockReturnValue({ "block-1": "hello" } as never);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-2",
      }),
    );

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!B2:B2",
      values: [["0.0000"]],
    });
  });

  it("leaves the uniqueness score blank when the calculation scope is exceeded", async () => {
    setupDbSelect(
      [INTEGRATION],
      [RESPONSE],
      [],
      Array.from({ length: 5001 }, (_, index) => ({
        id: `response-${index}`,
      })),
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID", "ユニーク度スコア", "block-1"]],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["response-0"]],
        },
      } as never);
    mockSafeParseResponseData.mockReturnValue({ "block-1": "hello" } as never);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-1", "", "hello"]],
      }),
    );
    expect(mockUpdateRange).not.toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalledTimes(6);
  });

  it("does not throw when best-effort done promotion fails", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    // First call (pending) succeeds; second call (done) rejects
    mockSetIdempotencyKey
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Redis unavailable"));

    const result = await handleSheetsSync(makeJob());

    expect(result).toMatchObject({ ok: true, provider: "google-sheets" });
    expect(mockSetIdempotencyKey).toHaveBeenCalledTimes(2);
  });
});

describe("handleSheetsSync — write path", () => {
  it("full mode skips clearing the sheet when any prepared response is not ready", async () => {
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: "invalid-json-content",
        },
      ],
      [],
      [{ id: "response-1" }],
      [],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => await fn());
    mockSafeParseResponseData.mockReturnValue(null);

    const job = makeJob({
      formId: "form-1",
      integrationId: "integration-1",
      mode: "full",
      responseId: "response-1",
    });

    const result = await handleSheetsSync(job as never);

    expect(mockClearSheet).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, skipped: 1, processed: 1 });
  });

  it("full mode propagates Redis idempotency key deletion errors", async () => {
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: '{"block-1":"first"}',
        },
      ],
      [],
      [{ id: "response-1" }],
      [],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => await fn());
    mockSafeParseResponseData.mockReturnValue({ "block-1": "first" });
    mockClearSheet.mockResolvedValueOnce({
      ok: true,
      data: { clearedRange: "Sheet1!1:1000000" },
    } as never);
    mockDeleteIdempotencyKey.mockImplementationOnce(async () => {
      throw new Error("Redis connection dropped");
    });

    const job = makeJob({
      formId: "form-1",
      integrationId: "integration-1",
      mode: "full",
      responseId: "response-1",
    });

    await expect(handleSheetsSync(job as never)).rejects.toThrow(
      "Redis connection dropped",
    );
  });

  it("full mode clears the sheet and rewrites all historical responses", async () => {
    setupDbSelect(
      // 1. formIntegration lookup
      [INTEGRATION],
      // 2. full-mode target response query, ordered by submittedAt/id
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: '{"block-1":"first"}',
        },
        {
          ...RESPONSE,
          id: "response-2",
          responseDataJson: '{"block-1":"second"}',
        },
      ],
      // 3. plate content lookup
      [],
      // 4. uniqueness-score cohort query, using the same stable order
      [{ id: "response-1" }, { id: "response-2" }],
      // 5. fingerprint detail query for the cohort
      [],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    let lockReleased = false;
    let insideLock = false;
    mockWithRedisLock.mockImplementation(async (_key, fn) => {
      insideLock = true;
      const result = await fn();
      insideLock = false;
      lockReleased = true;
      return result;
    });
    mockGetIdempotencyKeyValue.mockImplementation(async () => {
      expect(insideLock).toBe(true);
      return null;
    });
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockClearSheet.mockResolvedValue({
      ok: true,
      data: { clearedRange: "Sheet1!A1:Z1000000" },
    } as never);
    mockDeleteIdempotencyKey.mockResolvedValue(undefined);
    // response-1 reads an empty (just-cleared) sheet; response-2 reads the
    // headers written by response-1 plus the appended response-1 id column.
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: { values: [] },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [
            [
              "Response ID",
              "Respondent UUID",
              "Submitted At",
              "Updated At",
              "Country Code",
              "Uniqueness Score",
              "block-1",
            ],
            [
              "回答ID",
              "回答者UUID",
              "送信日時",
              "更新日時",
              "国コード",
              "ユニーク度スコア",
              "block-1",
            ],
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["回答ID"], ["response-1"]],
        },
      } as never);
    mockSafeParseResponseData.mockImplementation((json) => {
      const parsed: unknown = JSON.parse(String(json));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as never)
        : null;
    });
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockImplementation(async () => {
      expect(lockReleased).toBe(false);
      return {
        ok: true,
        data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
      } as never;
    });

    const job = makeJob({
      formId: "form-1",
      integrationId: "integration-1",
      mode: "full",
      responseId: "response-1",
    });

    const result = await handleSheetsSync(job);

    expect(result).toEqual({
      ok: true,
      provider: "google-sheets",
      jobId: "job-1",
      mode: "full",
      processed: 2,
      total: 2,
      skipped: 0,
      updatedRange: "Sheet1!A2",
      updatedRows: 2,
    });
    expect(mockClearSheet).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      sheetName: "Sheet1",
    });
    expect(mockDeleteIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
    );
    expect(mockDeleteIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-2",
    );
    expect(mockAppendRows).toHaveBeenCalledTimes(2);
    expect(mockWithRedisLock).toHaveBeenCalledOnce();
    expect(mockWithRedisLock).toHaveBeenCalledWith(
      "sheets-sync:integration-1",
      expect.any(Function),
      expect.objectContaining({
        ttlMs: SHEETS_SYNC_LOCK_TTL_MS * 2,
        waitTimeoutMs:
          SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS + SHEETS_SYNC_LOCK_TTL_MS,
      }),
    );
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-1", "", "", "", "", "1.0000", "first"]],
      }),
    );
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-2",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    );
    expect(mockDb.select).toHaveBeenCalledTimes(7);
    expect(lockReleased).toBe(true);
    expect(job.updateProgress).toHaveBeenLastCalledWith({
      processed: 2,
      stage: 100,
      total: 2,
    });
  });

  it("full mode excludes response ids absent from the current FormResponse set", async () => {
    setupDbSelect(
      // 1. formIntegration lookup
      [INTEGRATION],
      // 2. full-mode target response query; deleted response rows are absent
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: '{"block-1":"first"}',
        },
        {
          ...RESPONSE,
          id: "response-3",
          responseDataJson: '{"block-1":"third"}',
        },
      ],
      // 3. plate content lookup
      [],
      // 4. uniqueness-score cohort query, using only current response ids
      [{ id: "response-1" }, { id: "response-3" }],
      // 5. fingerprint detail query for the cohort
      [],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockClearSheet.mockResolvedValue({
      ok: true,
      data: { clearedRange: "Sheet1!A1:Z1000000" },
    } as never);
    mockDeleteIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [["Response ID", "block-1"]] },
    } as never);
    mockSafeParseResponseData.mockImplementation((json) => {
      const parsed: unknown = JSON.parse(String(json));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as never)
        : null;
    });
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A2", updatedRows: 2 },
    } as never);

    const result = await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        mode: "full",
        responseId: "response-1",
      }),
    );

    expect(result).toMatchObject({
      mode: "full",
      processed: 2,
      skipped: 0,
      total: 2,
    });
    expect(mockClearSheet).toHaveBeenCalledOnce();
    expect(mockAppendRows).toHaveBeenCalledTimes(2);
    const appendedRows = mockAppendRows.mock.calls.flatMap(
      ([, params]) => params.rows,
    );
    expect(appendedRows).toEqual([
      ["response-1", "first", "1.0000"],
      ["response-3", "third", "1.0000"],
    ]);
    expect(appendedRows.flat()).not.toContain("response-deleted");
  });

  it("full mode uses a non-leading response job only for that response", async () => {
    setupDbSelect(
      // 1. formIntegration lookup
      [INTEGRATION],
      // 2. full-mode target response query; response-2 is not the batch owner
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: '{"block-1":"first"}',
        },
        {
          ...RESPONSE,
          id: "response-2",
          responseDataJson: '{"block-1":"second"}',
        },
      ],
      // 3. plate content lookup
      [],
      // 4. uniqueness-score cohort query, using the same stable order
      [{ id: "response-1" }, { id: "response-2" }],
      // 5. fingerprint detail query for the cohort
      [],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [["Response ID", "block-1"]] },
    } as never);
    mockSafeParseResponseData.mockImplementation((json) => {
      const parsed: unknown = JSON.parse(String(json));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as never)
        : null;
    });
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
    } as never);

    const result = await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        mode: "full",
        responseId: "response-2",
      }),
    );

    expect(result).toEqual({
      ok: true,
      provider: "google-sheets",
      jobId: "job-1",
      mode: "full",
      processed: 1,
      total: 1,
      skipped: 0,
      updatedRange: "Sheet1!A2",
      updatedRows: 1,
    });
    expect(mockAppendRows).toHaveBeenCalledOnce();
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-2", "second", "1.0000"]],
      }),
    );
    expect(mockDb.select).toHaveBeenCalledTimes(7);
  });

  it("uses withRedisLock on the integration key", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);

    await handleSheetsSync(makeJob());

    // Lock TTL covers a pending-idempotency wait plus one Sheets critical section.
    expect(PENDING_IDEMPOTENCY_TTL_SECONDS).toBe(210);
    expect(SHEETS_SYNC_LOCK_TTL_MS).toBe(390_000);
    expect(SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS).toBe(395_000);
    expect(PENDING_IDEMPOTENCY_TTL_SECONDS).toBeGreaterThan(
      Math.ceil(
        (SHEETS_SYNC_LOCK_TTL_MS - PENDING_IDEMPOTENCY_TTL_SECONDS * 1000) /
          1000,
      ),
    );
    expect(mockWithRedisLock).toHaveBeenCalledWith(
      "sheets-sync:integration-1",
      expect.any(Function),
      expect.objectContaining({
        ttlMs: SHEETS_SYNC_LOCK_TTL_MS,
        waitTimeoutMs: SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS,
      }),
    );
  });

  it("keeps the integration lock alive through the maximum Sheets API calls", async () => {
    setupHappyPathMocks();
    setupDbSelect(
      [INTEGRATION],
      [RESPONSE],
      [],
      [{ id: "response-1" }, { id: "other-response" }],
      [],
    );
    mockGetIdempotencyKeyValue.mockResolvedValue(null);

    let elapsedMs = 0;
    let lockExpiresAtMs = 0;
    mockWithRedisLock.mockImplementationOnce(async (_key, fn, options) => {
      if (options?.ttlMs === undefined) {
        throw new Error("Expected sheets sync lock TTL");
      }
      lockExpiresAtMs = elapsedMs + options.ttlMs;
      const result = await fn();
      expect(elapsedMs).toBeLessThan(lockExpiresAtMs);
      return result;
    });

    const consumeSheetsApiTimeout = () => {
      expect(elapsedMs).toBeLessThan(lockExpiresAtMs);
      elapsedMs += SHEETS_API_TIMEOUT_MS;
      expect(elapsedMs).toBeLessThan(lockExpiresAtMs);
    };

    mockReadRange.mockImplementation(async (_token, params) => {
      consumeSheetsApiTimeout();
      if (params.rangeA1 === "Sheet1!1:1") {
        return {
          ok: true,
          data: { values: [["Response ID"]] },
        } as never;
      }
      return {
        ok: true,
        data: { values: [["Response ID"], ["other-response"]] },
      } as never;
    });
    mockUpdateRange.mockImplementation(async () => {
      consumeSheetsApiTimeout();
      return { ok: true } as never;
    });
    mockAppendRows.mockImplementation(async () => {
      consumeSheetsApiTimeout();
      return {
        ok: true,
        data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
      } as never;
    });

    const result = await handleSheetsSync(makeJob());

    expect(result).toMatchObject({ ok: true, updatedRows: 1 });
    expect(mockReadRange).toHaveBeenCalledTimes(2);
    expect(mockUpdateRange).toHaveBeenCalledTimes(2);
    expect(mockAppendRows).toHaveBeenCalledOnce();
    expect(elapsedMs).toBe(SHEETS_API_TIMEOUT_MS * 5);
    expect(lockExpiresAtMs - elapsedMs).toBeGreaterThanOrEqual(
      SHEETS_API_TIMEOUT_MS,
    );
  });

  it("does not append the same response twice across repeated jobs", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValueOnce(null);
    mockGetIdempotencyKeyValue.mockResolvedValueOnce("done");

    const firstResult = await handleSheetsSync(makeJob());
    setupDbSelect([INTEGRATION], [RESPONSE], []);
    const secondResult = await handleSheetsSync(makeJob());

    expect(firstResult).toMatchObject({
      ok: true,
      provider: "google-sheets",
      updatedRows: 1,
    });
    expect(secondResult).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).toHaveBeenCalledOnce();
    expect(mockSetIdempotencyKey).toHaveBeenCalledWith(
      "sheets-written:integration-1:response-1",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    );
  });

  it("writes a header row when the sheet is empty", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ rangeA1: "Sheet1!1:2" }),
    );
  });

  it("updates shared sheet title rows when only title headers changed", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    const sharedIdRow = [
      "Response ID",
      "Respondent UUID",
      "Submitted At",
      "Updated At",
      "Country Code",
      "Uniqueness Score",
      "block-1",
    ];
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [sharedIdRow, ["回答ID"]],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["回答ID"]],
        },
      } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:2",
      values: [
        sharedIdRow,
        [
          "回答ID",
          "回答者UUID",
          "送信日時",
          "更新日時",
          "国コード",
          "ユニーク度スコア",
          "block-1",
        ],
      ],
    });
  });

  it("does not treat a legacy first data row value as a shared title row", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [
            ["Response ID", "block-1"],
            ["回答ID", "legacy answer"],
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["回答ID"]],
        },
      } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:1",
      values: [["Response ID", "block-1", "ユニーク度スコア"]],
    });
    expect(mockUpdateRange).not.toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ rangeA1: "Sheet1!1:2" }),
    );
  });

  it("does not treat legacy data rows as shared title rows when headers match shared ids", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    const sharedIdRow = [
      "Response ID",
      "Respondent UUID",
      "Submitted At",
      "Updated At",
      "Country Code",
      "Uniqueness Score",
      "block-1",
    ];
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [
            sharedIdRow,
            [
              "response-1",
              "respondent-1",
              "2026-05-17T01:00:00.000Z",
              "",
              "JP",
              "1.0000",
              "legacy answer",
            ],
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["response-1"]],
        },
      } as never);

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockUpdateRange).not.toHaveBeenCalled();
  });

  it("does not treat shared id headers without a title row as shared layout", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [
            [
              "Response ID",
              "Respondent UUID",
              "Submitted At",
              "Updated At",
              "Country Code",
              "Uniqueness Score",
              "block-1",
            ],
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          values: [["Response ID"], ["response-1"]],
        },
      } as never);

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockUpdateRange).not.toHaveBeenCalled();
  });

  it("uses the shared export sheet contract for empty-sheet headers, metadata, and formula neutralization", async () => {
    const responseDataJson = JSON.stringify([
      {
        question_id: "formula-block",
        question_type: "short_text",
        question_title: "=Formula",
        value: " =cmd",
      },
    ]);
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          id: "=response-1",
          responseDataJson,
          respondentUuid: "-respondent-1",
          submittedAt: new Date("2026-05-17T01:00:00.000Z"),
          updatedAt: new Date("2026-05-17T02:30:00.000Z"),
          countryCode: "JP",
          userAgent: " @ua",
        },
      ],
      [{ plateContent: JSON.stringify([{ type: "p" }]) }],
      [{ id: "=response-1" }],
      [
        {
          responseId: "=response-1",
          componentName: "canvas",
          componentValueHash: "same-hash",
          fingerprintType: "browser",
        },
      ],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);
    mockSafeParseResponseData.mockReturnValue({
      "formula-block": " =cmd",
    } as never);
    mockExtractQuestionsFromPlateContent.mockReturnValue([
      {
        blockId: "formula-block",
        title: "=Formula",
        type: "short_text",
        validation: {},
      },
    ]);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "=response-1",
      }),
    );

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:2",
      values: [
        [
          "Response ID",
          "Respondent UUID",
          "Submitted At",
          "Updated At",
          "Country Code",
          "Uniqueness Score",
          "formula-block",
        ],
        [
          "回答ID",
          "回答者UUID",
          "送信日時",
          "更新日時",
          "国コード",
          "ユニーク度スコア",
          "'=Formula",
        ],
      ],
    });
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [
          [
            "'=response-1",
            "'-respondent-1",
            "2026-05-17T01:00:00.000Z",
            "2026-05-17T02:30:00.000Z",
            "JP",
            "1.0000",
            "' =cmd",
          ],
        ],
      }),
    );
    expect(mockUpdateRange.mock.calls[0]?.[1].values[0]).not.toContain(
      "UA UUID",
    );
    expect(mockUpdateRange.mock.calls[0]?.[1].values[0]).not.toContain(
      "canvas UUID",
    );
  });

  it("writes selected arbitrary validation output values with shared sheet headers", async () => {
    const structureJson = JSON.stringify({
      version: 1,
      settings: {
        validation_output_export: {
          values: [
            {
              rule_id: "rule-gh",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "followers",
              enabled: false,
            },
          ],
        },
      },
    });
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: "[]",
          respondentUuid: "respondent-1",
          submittedAt: new Date("2026-05-17T01:00:00.000Z"),
          updatedAt: null,
          countryCode: "JP",
          userAgent: null,
        },
      ],
      [{ plateContent: "[]" }],
      [{ id: "response-1" }],
      [],
      [{ structureJson }],
      [
        {
          responseId: "response-1",
          ruleId: "rule-gh",
          metadata: {
            validationOutputs: [
              {
                key: "username",
                label: "GitHub username",
                value: "octocat",
              },
              { key: "followers", label: "Followers", value: 42 },
              { key: "profile_score", label: "Profile score", value: 98.5 },
            ],
          },
          service: "github",
          ruleName: "GitHub rule",
          providerName: "github",
          ruleType: "user_exists",
        },
      ],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);
    mockSafeParseResponseData.mockReturnValue({} as never);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:2",
      values: [
        [
          "Response ID",
          "Respondent UUID",
          "Submitted At",
          "Updated At",
          "Country Code",
          "Uniqueness Score",
          "validation_output:rule-gh:profile_score",
          "validation_output:rule-gh:username",
        ],
        [
          "回答ID",
          "回答者UUID",
          "送信日時",
          "更新日時",
          "国コード",
          "ユニーク度スコア",
          "Validation: GitHub rule (rule-gh) / Profile score [profile_score]",
          "Validation: GitHub rule (rule-gh) / GitHub username [username]",
        ],
      ],
    });
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [
          [
            "response-1",
            "respondent-1",
            "2026-05-17T01:00:00.000Z",
            "",
            "JP",
            "1.0000",
            "98.5",
            "octocat",
          ],
        ],
      }),
    );
    expect(mockUpdateRange.mock.calls[0]?.[1].values.flat()).not.toContain(
      "Followers",
    );
  });

  it("writes selected validation output values to legacy sheet headers", async () => {
    const structureJson = JSON.stringify({
      version: 1,
      settings: {
        validation_output_export: {
          values: [
            {
              rule_id: "rule-gh",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "followers",
              enabled: false,
            },
          ],
        },
      },
    });
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          id: "response-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-05-17T01:00:00.000Z"),
        },
      ],
      [{ plateContent: "[]" }],
      [{ id: "response-1" }],
      [],
      [{ structureJson }],
      [
        {
          responseId: "response-1",
          ruleId: "rule-gh",
          metadata: {
            validationOutputs: [
              {
                key: "username",
                label: "GitHub username",
                value: "octocat",
              },
              { key: "followers", label: "Followers", value: 42 },
              { key: "profile_score", label: "Profile score", value: 98.5 },
            ],
          },
          service: "github",
          ruleName: "GitHub rule",
          providerName: "github",
          ruleType: "user_exists",
        },
      ],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange
      .mockResolvedValueOnce({
        ok: true,
        data: { values: [["Response ID"]] },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { values: [["Response ID"]] },
      } as never);
    mockSafeParseResponseData.mockReturnValue({} as never);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).toHaveBeenCalledWith(TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!1:1",
      values: [
        [
          "Response ID",
          "ユニーク度スコア",
          "Validation: GitHub rule (rule-gh) / Profile score [profile_score]",
          "Validation: GitHub rule (rule-gh) / GitHub username [username]",
        ],
      ],
    });
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-1", "1.0000", "98.5", "octocat"]],
      }),
    );
    expect(mockUpdateRange.mock.calls[0]?.[1].values.flat()).not.toContain(
      "Followers",
    );
  });

  it("uses display labels for dropdown, checkbox, and grid answers in shared sheet rows", async () => {
    const responseDataJson = JSON.stringify([
      {
        question_id: "tool-dropdown",
        question_type: "dropdown",
        question_title: "利用ツール",
        value: "react",
      },
      {
        question_id: "interest-checkbox",
        question_type: "checkbox",
        question_title: "興味",
        values: ["ts", "react"],
      },
      {
        question_id: "availability-choice-grid",
        question_type: "choice_grid",
        question_title: "参加可能日",
        responses: { monday: "morning" },
      },
      {
        question_id: "availability-checkbox-grid",
        question_type: "checkbox_grid",
        question_title: "参加可能時間",
        responses: { monday: ["morning", "evening"], tuesday: [] },
      },
    ]);
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          responseDataJson,
          respondentUuid: "respondent-choice",
          submittedAt: new Date("2026-05-17T01:00:00.000Z"),
          updatedAt: null,
          countryCode: "JP",
          userAgent: null,
        },
      ],
      [{ plateContent: JSON.stringify([{ type: "p" }]) }],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);
    mockSafeParseResponseData.mockImplementation((json) => {
      const parsed: unknown = JSON.parse(json);
      const result = responsePayloadItemSchema.array().safeParse(parsed);
      if (!result.success) return null;
      return Object.fromEntries(
        result.data.map((item) => {
          if (item.responses) {
            return [item.question_id, JSON.stringify(item.responses)];
          }
          if (Array.isArray(item.values)) {
            return [item.question_id, item.values.map(String).join(",")];
          }
          return [
            item.question_id,
            item.value === null || item.value === undefined
              ? ""
              : String(item.value),
          ];
        }),
      );
    });
    mockExtractQuestionsFromPlateContent.mockReturnValue([
      {
        blockId: "tool-dropdown",
        title: "利用ツール",
        type: "dropdown",
        validation: {
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "react", label: "React" },
          ],
        },
      },
      {
        blockId: "interest-checkbox",
        title: "興味",
        type: "checkbox",
        validation: {
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "react", label: "React" },
          ],
        },
      },
      {
        blockId: "availability-choice-grid",
        title: "参加可能日",
        type: "choice_grid",
        validation: {
          rows: [
            { id: "monday", label: "月曜" },
            { id: "tuesday", label: "火曜" },
          ],
          columns: [{ id: "morning", label: "午前" }],
        },
      },
      {
        blockId: "availability-checkbox-grid",
        title: "参加可能時間",
        type: "checkbox_grid",
        validation: {
          rows: [
            { id: "monday", label: "月曜" },
            { id: "tuesday", label: "火曜" },
            { id: "wednesday", label: "水曜" },
          ],
          columns: [
            { id: "morning", label: "午前" },
            { id: "evening", label: "夜" },
          ],
        },
      },
    ]);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    const updateValues = getFirstUpdateValues();
    expect(getUpdateRow(updateValues, 0)).toEqual([
      "Response ID",
      "Respondent UUID",
      "Submitted At",
      "Updated At",
      "Country Code",
      "Uniqueness Score",
      "tool-dropdown",
      "interest-checkbox",
      "availability-choice-grid",
      "availability-checkbox-grid",
    ]);
    expect(getUpdateRow(updateValues, 1)).toEqual([
      "回答ID",
      "回答者UUID",
      "送信日時",
      "更新日時",
      "国コード",
      "ユニーク度スコア",
      "利用ツール",
      "興味",
      "参加可能日",
      "参加可能時間",
    ]);
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [
          [
            "response-1",
            "respondent-choice",
            "2026-05-17T01:00:00.000Z",
            "",
            "JP",
            "1.0000",
            "React",
            "TypeScript, React",
            "月曜: 午前\n火曜: 未回答",
            "月曜: 午前, 夜\n火曜: 未回答\n水曜: 未回答",
          ],
        ],
      }),
    );
  });

  it("keeps unvisited section-branch answers blank and excludes section blocks in shared sheet rows", async () => {
    const responseDataJson = JSON.stringify([
      {
        question_id: "q-entity-type",
        question_type: "radio",
        question_title: "契約種別",
        value: "individual",
      },
    ]);
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          responseDataJson,
          respondentUuid: "respondent-individual",
          submittedAt: new Date("2026-05-17T01:00:00.000Z"),
        },
      ],
      [{ plateContent: JSON.stringify([{ type: "p" }]) }],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);
    mockSafeParseResponseData.mockReturnValue({
      "q-entity-type": "individual",
    } as never);
    mockExtractQuestionsFromPlateContent.mockReturnValue([
      {
        blockId: "q-entity-type",
        title: "契約種別",
        type: "radio",
        validation: {
          options: [{ id: "individual", label: "個人" }],
        },
      },
      {
        blockId: "section-corporate",
        title: "法人追加情報",
        type: "section_separator",
        validation: {},
      },
      {
        blockId: "q-company-name",
        title: "法人名",
        type: "short_text",
        validation: { required: true },
      },
    ]);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    const updateValues = getFirstUpdateValues();
    const idRow = getUpdateRow(updateValues, 0);
    const titleRow = getUpdateRow(updateValues, 1);
    expect(idRow).not.toContain("section-corporate");
    expect(titleRow).not.toContain("法人追加情報");
    expect(idRow.slice(-2)).toEqual(["q-entity-type", "q-company-name"]);
    expect(titleRow.slice(-2)).toEqual(["契約種別", "法人名"]);
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [
          [
            "response-1",
            "respondent-individual",
            "2026-05-17T01:00:00.000Z",
            "",
            "",
            "1.0000",
            "個人",
            "",
          ],
        ],
      }),
    );
  });

  it("keeps duplicate shared sheet titles disambiguated with suffixes", async () => {
    setupDbSelect(
      [INTEGRATION],
      [
        {
          ...RESPONSE,
          responseDataJson: JSON.stringify([
            {
              question_id: "first-name",
              question_type: "short_text",
              question_title: "名前",
              value: "山田",
            },
            {
              question_id: "second-name",
              question_type: "short_text",
              question_title: "名前",
              value: "太郎",
            },
            {
              question_id: "literal-suffix-name",
              question_type: "short_text",
              question_title: "名前 (1)",
              value: "花子",
            },
          ]),
          respondentUuid: "respondent-duplicate",
          submittedAt: new Date("2026-05-17T01:00:00.000Z"),
        },
      ],
      [{ plateContent: JSON.stringify([{ type: "p" }]) }],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);
    mockSafeParseResponseData.mockReturnValue({
      "first-name": "山田",
      "literal-suffix-name": "花子",
      "second-name": "太郎",
    } as never);
    mockExtractQuestionsFromPlateContent.mockReturnValue([
      {
        blockId: "first-name",
        title: "名前",
        type: "short_text",
        validation: {},
      },
      {
        blockId: "second-name",
        title: "名前",
        type: "short_text",
        validation: {},
      },
      {
        blockId: "literal-suffix-name",
        title: "名前 (1)",
        type: "short_text",
        validation: {},
      },
    ]);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A3", updatedRows: 1 },
    } as never);

    await handleSheetsSync(makeJob());

    expect(getUpdateRow(getFirstUpdateValues(), 1).slice(-3)).toEqual([
      "名前",
      "名前 (2)",
      "名前 (1)",
    ]);
  });

  it("uses the submitted snapshot plate content when snapshotVersion is present", async () => {
    const snapshotPlateContent = JSON.stringify([{ type: "p" }]);
    setupDbSelect(
      [INTEGRATION],
      [RESPONSE],
      [{ plateContent: snapshotPlateContent }],
    );
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(TOKEN as never);
    mockWithRedisLock.mockImplementation(async (_key, fn) => fn());
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSetIdempotencyKey.mockResolvedValue(undefined);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [["Response ID"]] },
    } as never);
    mockSafeParseResponseData.mockReturnValue({ "block-1": "hello" } as never);
    mockExtractQuestionsFromPlateContent.mockReturnValue([
      {
        blockId: "block-1",
        title: "Submitted Label",
        type: "short_text",
        validation: {},
      },
    ]);
    mockUpdateRange.mockResolvedValue({ ok: true } as never);
    mockAppendRows.mockResolvedValue({
      ok: true,
      data: { updatedRange: "Sheet1!A2", updatedRows: 1 },
    } as never);

    await handleSheetsSync(
      makeJob({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-1",
        snapshotVersion: 3,
      }),
    );

    expect(mockExtractQuestionsFromPlateContent).toHaveBeenCalledWith(
      JSON.parse(snapshotPlateContent),
    );
    expect(mockUpdateRange).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        values: [["Response ID", "ユニーク度スコア", "Submitted Label"]],
      }),
    );
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-1", "1.0000", "hello"]],
      }),
    );
  });

  it("skips header update when existing headers cover all columns", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    // Extra column already present — no new column needed
    mockReadRange.mockResolvedValue({
      ok: true,
      data: {
        values: [["Response ID", "ユニーク度スコア", "block-1", "extra-col"]],
      },
    } as never);

    await handleSheetsSync(makeJob());

    expect(mockUpdateRange).not.toHaveBeenCalled();
  });

  it("skips row write and returns invalid_data when response data is unparseable", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockSafeParseResponseData.mockReturnValue(null);

    const result = await handleSheetsSync(makeJob());

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "invalid_data",
      provider: "google-sheets",
      jobId: "job-1",
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).not.toHaveBeenCalled();
  });

  it("rethrows on rate limit from appendRows", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockAppendRows.mockResolvedValue({
      ok: false,
      error: { code: "rateLimit", message: "quota exceeded" },
    } as never);

    const job = makeJob();
    await expect(handleSheetsSync(job)).rejects.toThrow(
      "Google Sheets API rate limit",
    );
    expect(job.discard).not.toHaveBeenCalled();
  });

  it("discards and throws unauthorized response from updateRange as AUTH_REQUIRED", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [] },
    } as never);
    mockUpdateRange.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "invalid credentials" },
    } as never);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow(
      "AUTH_REQUIRED: update headers: invalid credentials",
    );
    expect(job.discard).not.toHaveBeenCalled();

    expect(mockAppendRows).not.toHaveBeenCalled();
  });

  it("discards and throws unauthorized response from appendRows as AUTH_REQUIRED", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockAppendRows.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "invalid credentials" },
    } as never);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow(
      "AUTH_REQUIRED: append rows: invalid credentials",
    );
    expect(job.discard).not.toHaveBeenCalled();
  });

  it("discards and throws forbidden response from appendRows as AUTH_REQUIRED", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockAppendRows.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", message: "forbidden access" },
    } as never);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow(
      "AUTH_REQUIRED: append rows: forbidden access",
    );
    expect(job.discard).not.toHaveBeenCalled();
  });
});
