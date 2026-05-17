import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nexus-form/database", () => ({
  db: { select: vi.fn() },
  formIntegration: {},
  formResponse: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {},
}));

vi.mock("@nexus-form/shared", () => ({
  extractQuestionsFromPlateContent: vi.fn().mockReturnValue([]),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../../lib/google-sheets-client", () => ({
  appendRows: vi.fn(),
  readRange: vi.fn(),
  updateRange: vi.fn(),
}));

vi.mock("../../lib/oauth-token-store", () => ({
  getOAuthToken: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock("../../lib/redis-lock", () => ({
  getIdempotencyKeyValue: vi.fn(),
  setIdempotencyKey: vi.fn(),
  withRedisLock: vi.fn(),
}));

vi.mock("../../lib/response-data-extractor", () => ({
  safeParseResponseData: vi.fn(),
}));

import { db } from "@nexus-form/database";
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
  getIdempotencyKeyValue,
  setIdempotencyKey,
  withRedisLock,
} from "../../lib/redis-lock";
import { safeParseResponseData } from "../../lib/response-data-extractor";
import { handleSheetsSync } from "../sheets-sync";

const mockDb = vi.mocked(db);
const mockGetIdempotencyKeyValue = vi.mocked(getIdempotencyKeyValue);
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
const DONE_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

function makeJob(
  data: { formId: string; integrationId: string; responseId: string } = {
    formId: "form-1",
    integrationId: "integration-1",
    responseId: "response-1",
  },
): Job {
  return {
    id: "job-1",
    data,
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
  vi.clearAllMocks();
});

describe("handleSheetsSync — idempotency states", () => {
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

  it('throws a retry error when idempotency key is "pending"', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue("pending");
    mockReadRange.mockResolvedValueOnce({
      ok: true,
      data: { values: [["Response ID", "block-1"]] },
    } as never);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "[sheets-sync] Concurrent write in progress",
    );
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetIdempotencyKey).not.toHaveBeenCalled();
  });

  it('promotes "pending" to "done" when the response row already exists', async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue("pending");
    mockReadRange.mockResolvedValueOnce({
      ok: true,
      data: {
        values: [
          ["Response ID", "block-1"],
          ["response-1", "hello"],
        ],
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
  });

  it("skips append when the idempotency key expired but the response row already exists", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockReadRange.mockResolvedValueOnce({
      ok: true,
      data: {
        values: [
          ["Response ID", "block-1"],
          ["response-1", "hello"],
        ],
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
    expect(mockSetIdempotencyKey).not.toHaveBeenCalled();
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

    // "pending" must be set BEFORE appendRows (first setIdempotencyKey call)
    const [firstCall, secondCall] = mockSetIdempotencyKey.mock.calls;
    expect(firstCall).toEqual([
      "sheets-written:integration-1:response-1",
      90,
      "pending",
    ]);
    // "done" must be set AFTER appendRows (second setIdempotencyKey call)
    expect(secondCall).toEqual([
      "sheets-written:integration-1:response-1",
      DONE_IDEMPOTENCY_TTL_SECONDS,
      "done",
    ]);
    // Verify ordering: pending → appendRows → done
    expect(getInvocationCallOrder(mockSetIdempotencyKey, 0)).toBeLessThan(
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

    expect(mockWithRedisLock).toHaveBeenCalledWith(
      "sheets-sync:integration-1",
      expect.any(Function),
      expect.objectContaining({ ttlMs: 60_000, waitTimeoutMs: 65_000 }),
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
  });

  it("rethrows on rate limit from appendRows", async () => {
    setupHappyPathMocks();
    mockGetIdempotencyKeyValue.mockResolvedValue(null);
    mockAppendRows.mockResolvedValue({
      ok: false,
      error: { code: "rateLimit", message: "quota exceeded" },
    } as never);

    await expect(handleSheetsSync(makeJob())).rejects.toThrow(
      "Google Sheets API rate limit",
    );
  });
});
