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
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {},
  formSnapshot: {},
}));

vi.mock("@nexus-form/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus-form/shared")>();
  return {
    ...actual,
    extractQuestionsFromPlateContent: vi.fn().mockReturnValue([]),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
  eq: vi.fn((column: unknown, value: unknown) => ({
    column,
    type: "eq",
    value,
  })),
}));

vi.mock("../../lib/google-sheets-client", () => ({
  appendRows: vi.fn(),
  readRange: vi.fn(),
  SHEETS_API_TIMEOUT_MS: 30_000,
  updateRange: vi.fn(),
}));

vi.mock("../../lib/oauth-token-store", () => ({
  getOAuthToken: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock("../../lib/redis-lock", () => ({
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
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import { and } from "drizzle-orm";
import {
  appendRows,
  readRange,
  updateRange,
} from "../../lib/google-sheets-client";
import {
  getOAuthToken,
  refreshTokenIfNeeded,
} from "../../lib/oauth-token-store";
import {
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
const mockRefreshTokenIfNeeded = vi.mocked(refreshTokenIfNeeded);
const mockReadRange = vi.mocked(readRange);
const mockUpdateRange = vi.mocked(updateRange);
const mockAppendRows = vi.mocked(appendRows);
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
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(result),
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

beforeEach(() => {
  shutdownSignalMock.reset();
  vi.clearAllMocks();
  mockExtractQuestionsFromPlateContent.mockReturnValue([]);
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

  it("response が job の formId に属さない場合はSheets API呼び出し前に失敗する", async () => {
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

  it("throws UnrecoverableError when OAuth token refresh fails", async () => {
    setupDbSelect([INTEGRATION]);
    mockGetOAuthToken.mockResolvedValue(TOKEN as never);
    mockRefreshTokenIfNeeded.mockResolvedValue(null as never);

    const job = makeJob();
    const task = handleSheetsSync(job);
    await expect(task).rejects.toThrow(UnrecoverableError);
    await expect(task).rejects.toThrow(
      "AUTH_REQUIRED: OAuth token refresh failed",
    );
    expect(job.discard).not.toHaveBeenCalled();

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
      rangeA1: "Sheet1!1:1",
    });
    expect(mockReadRange).toHaveBeenNthCalledWith(2, TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!A:A",
    });
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
      rangeA1: "Sheet1!1:1",
    });
    expect(mockReadRange).toHaveBeenNthCalledWith(2, TOKEN, {
      spreadsheetId: "spreadsheet-id",
      rangeA1: "Sheet1!A:A",
    });
    expect(getInvocationCallOrder(mockSetIdempotencyKey, 0)).toBeLessThan(
      getInvocationCallOrder(mockReadRange, 0),
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
  it("uses withRedisLock on the integration key", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);

    await handleSheetsSync(makeJob());

    // Lock TTL covers a pending-idempotency wait plus one Sheets critical section.
    expect(PENDING_IDEMPOTENCY_TTL_SECONDS).toBe(180);
    expect(SHEETS_SYNC_LOCK_TTL_MS).toBe(330_000);
    expect(SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS).toBe(335_000);
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
      expect.objectContaining({ rangeA1: "Sheet1!1:1" }),
    );
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
        values: [["Response ID", "Submitted Label"]],
      }),
    );
    expect(mockAppendRows).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        rows: [["response-1", "hello"]],
      }),
    );
  });

  it("skips header update when existing headers cover all columns", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    // Extra column already present — no new column needed
    mockReadRange.mockResolvedValue({
      ok: true,
      data: { values: [["Response ID", "block-1", "extra-col"]] },
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
