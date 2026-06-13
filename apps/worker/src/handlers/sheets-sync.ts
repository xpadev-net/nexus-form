/**
 * Google Sheets 同期ハンドラ
 *
 * 新しいフォーム回答をGoogle Sheetsに追記する
 */

import { db, formIntegration, formResponse } from "@nexus-form/database";
import { form, formSnapshot } from "@nexus-form/database/schema";
import {
  extractQuestionsFromPlateContent,
  type SheetsSyncJobData,
  sheetsSyncJobDataSchema,
} from "@nexus-form/shared";
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  appendRows,
  type GoogleApiError,
  readRange,
  SHEETS_API_TIMEOUT_MS,
  updateRange,
} from "../lib/google-sheets-client";
import {
  getOAuthToken,
  type OAuthToken,
  refreshTokenIfNeeded,
} from "../lib/oauth-token-store";
import {
  getIdempotencyKeyTtlMs,
  getIdempotencyKeyValue,
  setIdempotencyKey,
  withRedisLock,
} from "../lib/redis-lock";
import { safeParseResponseData } from "../lib/response-data-extractor";
import { workerShutdownSignal } from "../lib/shutdown-signal";

export type SheetsSyncJob = SheetsSyncJobData;

const RESPONSE_ID_HEADER = "Response ID";
// Maximum Sheets API calls inside the critical section:
// 2 reads (idempotency check) + 1 conditional header update + 1 append
const SHEETS_SYNC_API_CALLS_IN_CRITICAL_SECTION = 4;
// Add the headroom using the same timeout unit as Sheets API calls.
const SHEETS_SYNC_LOCK_BUFFER_MS = SHEETS_API_TIMEOUT_MS;
const PENDING_IDEMPOTENCY_EXTRA_BUFFER_MS = 30_000;
const PENDING_IDEMPOTENCY_POLL_INTERVAL_MS = 1_000;
const PENDING_IDEMPOTENCY_EXPIRED_SETTLE_MS = 100;
export const AUTH_REQUIRED_SYNC_ERROR_PREFIX = "AUTH_REQUIRED";
type SheetsSyncAuthFailure = "AUTH_REQUIRED" | "OTHER_FAILURE";

function classifySheetsSyncFailure(
  error: GoogleApiError,
): SheetsSyncAuthFailure {
  return error.code === "unauthorized" || error.code === "forbidden"
    ? "AUTH_REQUIRED"
    : "OTHER_FAILURE";
}

function getSheetsSyncFailureMessage(
  context: string,
  result: { error: GoogleApiError },
): string {
  if (classifySheetsSyncFailure(result.error) === "AUTH_REQUIRED") {
    return `${AUTH_REQUIRED_SYNC_ERROR_PREFIX}: ${context}: ${result.error.message}`;
  }

  if (result.error.code === "rateLimit") {
    return `Google Sheets API rate limit: ${context}: ${result.error.message}`;
  }

  return `Failed to ${context}: ${result.error.message}`;
}

function failSheetsSyncWithoutRetry(reason: string): never {
  throw new UnrecoverableError(reason);
}

function throwSheetsSyncFailure(
  context: string,
  result: { error: GoogleApiError },
): never {
  const message = getSheetsSyncFailureMessage(context, result);
  if (classifySheetsSyncFailure(result.error) === "AUTH_REQUIRED") {
    failSheetsSyncWithoutRetry(message);
  }
  throw new Error(message);
}
function authRequiredMessage(context: string): string {
  return `${AUTH_REQUIRED_SYNC_ERROR_PREFIX}: ${context}`;
}

function sleepForPendingIdempotency(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  if (workerShutdownSignal.aborted) {
    throw workerShutdownSignal.reason instanceof Error
      ? workerShutdownSignal.reason
      : new Error("Worker shutdown");
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        workerShutdownSignal.reason instanceof Error
          ? workerShutdownSignal.reason
          : new Error("Worker shutdown"),
      );
    };
    timer = setTimeout(() => {
      workerShutdownSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    workerShutdownSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exported public API: Redis lock TTL in ms; sized for one pending
 * idempotency wait plus one critical section.
 */
const SHEETS_SYNC_API_CRITICAL_TIMEOUT_MS =
  SHEETS_API_TIMEOUT_MS * SHEETS_SYNC_API_CALLS_IN_CRITICAL_SECTION;
const SHEETS_SYNC_CRITICAL_SECTION_TTL_MS =
  SHEETS_SYNC_API_CRITICAL_TIMEOUT_MS + SHEETS_SYNC_LOCK_BUFFER_MS;
/** Exported public API: pending idempotency TTL in seconds; must exceed one critical section by an extra retry margin. */
export const PENDING_IDEMPOTENCY_TTL_SECONDS = Math.ceil(
  (SHEETS_SYNC_CRITICAL_SECTION_TTL_MS + PENDING_IDEMPOTENCY_EXTRA_BUFFER_MS) /
    1000,
);
export const SHEETS_SYNC_LOCK_TTL_MS =
  SHEETS_SYNC_CRITICAL_SECTION_TTL_MS + PENDING_IDEMPOTENCY_TTL_SECONDS * 1000;
/** Exported public API: Redis lock wait timeout in ms; covers one held lock. */
export const SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS = SHEETS_SYNC_LOCK_TTL_MS + 5_000;
export const DONE_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const GoogleSheetsIntegrationSettingSchema = z.object({
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
});

const IntegrationConfigSchema = z.record(z.string(), z.unknown());
type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

function resolveGoogleSheetsConfig(
  rawConfig: IntegrationConfig,
): IntegrationConfig {
  if (rawConfig.googleSheets == null) {
    return rawConfig;
  }

  const googleSheetsConfigResult = IntegrationConfigSchema.safeParse(
    rawConfig.googleSheets,
  );
  if (!googleSheetsConfigResult.success) {
    throw new Error("Google Sheets integration setting must be an object");
  }
  return googleSheetsConfigResult.data;
}

export const handleSheetsSync = async (job: Job<SheetsSyncJob>) => {
  const { formId, integrationId, responseId, snapshotVersion } =
    sheetsSyncJobDataSchema.parse(job.data);

  // 1. Integration設定を取得
  const [integration] = await db
    .select()
    .from(formIntegration)
    .where(
      and(
        eq(formIntegration.id, integrationId),
        eq(formIntegration.formId, formId),
      ),
    )
    .limit(1);

  if (!integration) {
    throw new Error(`Form integration not found: ${integrationId}`);
  }

  const rawConfigJson = integration.configJson;
  if (rawConfigJson == null) {
    throw new Error("Form integration configJson is empty");
  }

  let parsedConfig: unknown;
  try {
    parsedConfig =
      typeof rawConfigJson === "string"
        ? JSON.parse(rawConfigJson)
        : rawConfigJson;
  } catch {
    throw new Error("Form integration configJson is not valid");
  }
  const rawConfigResult = IntegrationConfigSchema.safeParse(parsedConfig);
  if (!rawConfigResult.success) {
    throw new Error("Form integration configJson must be an object");
  }
  const rawConfig = rawConfigResult.data;
  const googleSheetsConfig = resolveGoogleSheetsConfig(rawConfig);
  const settingResult =
    GoogleSheetsIntegrationSettingSchema.safeParse(googleSheetsConfig);

  if (!settingResult.success) {
    const paths = settingResult.error.issues.map((i) => i.path.join("."));
    console.error("[sheets-sync] Invalid Google Sheets integration setting", {
      issueCount: settingResult.error.issues.length,
      paths,
    });
    throw new Error("Invalid Google Sheets integration setting");
  }

  const { spreadsheetId, sheetName } = settingResult.data;
  await job.updateProgress(10);

  // 2. OAuthトークンを取得
  const userId = integration.userId ?? integration.ownerUserId;
  if (!userId) {
    throw new Error("No user ID found for integration");
  }

  const initialToken = await getOAuthToken(userId);
  if (!initialToken) {
    return failSheetsSyncWithoutRetry(
      authRequiredMessage("OAuth token not found"),
    );
  }

  const token = await refreshTokenIfNeeded(initialToken);
  if (!token) {
    return failSheetsSyncWithoutRetry(
      authRequiredMessage("OAuth token refresh failed"),
    );
  }
  await job.updateProgress(20);

  // 3. 同期対象のレスポンスを取得
  const [response] = await db
    .select()
    .from(formResponse)
    .where(
      and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
    )
    .limit(1);

  if (!response) {
    throw new Error(`Form response not found: ${responseId}`);
  }

  // 4. 送信時 snapshot の Plate コンテンツからブロックタイトルマップを構築。
  // 古いジョブに snapshotVersion が無い場合だけ現在の draft にフォールバックする。
  const [plateRecord] =
    snapshotVersion === undefined
      ? await db
          .select({ plateContent: form.plateContent })
          .from(form)
          .where(eq(form.id, formId))
          .limit(1)
      : await db
          .select({ plateContent: formSnapshot.plateContent })
          .from(formSnapshot)
          .where(
            and(
              eq(formSnapshot.formId, formId),
              eq(formSnapshot.version, snapshotVersion),
            ),
          )
          .limit(1);

  const blockTitleMap = new Map<string, string>();
  if (plateRecord?.plateContent) {
    try {
      const parsed: unknown = JSON.parse(plateRecord.plateContent);
      if (Array.isArray(parsed)) {
        for (const q of extractQuestionsFromPlateContent(parsed)) {
          if (q.blockId) {
            blockTitleMap.set(q.blockId, q.title || q.blockId);
          }
        }
      }
    } catch {
      // plateContent が不正な場合はマップを空のまま続行
    }
  }
  await job.updateProgress(40);

  const idempotencyKey = `sheets-written:${integrationId}:${response.id}`;
  const lockKey = `sheets-sync:${integrationId}`;

  const duplicateSkippedResult = () => ({
    ok: true,
    skipped: true,
    reason: "duplicate",
    provider: "google-sheets",
    jobId: job.id,
  });

  // 5-9. ロックでシート書き込みを直列化（ヘッダー競合を防ぐ）
  // BullMQ jobId deduplication prevents duplicate concurrent jobs.
  // A Redis idempotency key guards against duplicate rows on BullMQ retries
  // (jobId dedup only applies while the job is still in the queue).
  return await withRedisLock(
    lockKey,
    async () => {
      while (true) {
        const keyValue = await getIdempotencyKeyValue(idempotencyKey);

        if (keyValue === "done") {
          // A prior attempt already wrote the row; skip.
          return duplicateSkippedResult();
        }

        const markDuplicateWritten = async () => {
          await setIdempotencyKey(
            idempotencyKey,
            DONE_IDEMPOTENCY_TTL_SECONDS,
            "done",
          ).catch((e: unknown) => {
            console.warn(
              `[sheets-sync] Could not persist idempotency key ${idempotencyKey}: ${e instanceof Error ? e.message : e}`,
            );
          });
          return duplicateSkippedResult();
        };

        if (keyValue === "pending") {
          // The lock TTL expired while another job's critical section is still in
          // progress, or the prior attempt crashed before the row was written.
          // Keep the integration lock while waiting so no other response can
          // update headers or append rows for this integration in between.
          const pendingResult =
            await waitForPendingIdempotencyToResolve(idempotencyKey);
          if (pendingResult === "done") {
            return duplicateSkippedResult();
          }
          continue;
        }

        // 5. レスポンスデータをパース（不正データはスキップして再試行ループを避ける）
        const responseData = safeParseResponseData(
          response.responseDataJson,
          response.id,
        );
        if (!responseData) {
          return {
            ok: true,
            skipped: true,
            reason: "invalid_data",
            provider: "google-sheets",
            jobId: job.id,
          };
        }

        // Mark as "pending" before any Sheets API call in this critical section.
        // If Redis is unavailable, throw so the job retries rather than writing
        // without the duplicate guard.
        await setIdempotencyKey(
          idempotencyKey,
          PENDING_IDEMPOTENCY_TTL_SECONDS,
          "pending",
        );

        const sheetCheck = await readSheetForIdempotency(token, {
          spreadsheetId,
          sheetName,
          responseId: response.id,
        });
        if (sheetCheck.exists) {
          return markDuplicateWritten();
        }

        // 6. ヘッダー行を取得
        const existingHeaders = sheetCheck.headers;

        await job.updateProgress(60);

        // 7. ヘッダーと行データを構築
        const { headers, row } = buildRowFromResponse(
          existingHeaders,
          responseData,
          blockTitleMap,
          response.id,
        );

        // 8. ヘッダーが変更された場合は更新
        if (
          existingHeaders.length === 0 ||
          headers.length > existingHeaders.length
        ) {
          const headerUpdateResult = await updateRange(token, {
            spreadsheetId,
            rangeA1: `${sheetName}!1:1`,
            values: [headers],
          });
          if (!headerUpdateResult.ok) {
            throwSheetsSyncFailure("update headers", headerUpdateResult);
          }
        }
        await job.updateProgress(80);

        // 9. 行を追記
        const appendResult = await appendRows(token, {
          spreadsheetId,
          sheetName,
          rows: [row],
        });

        if (!appendResult.ok) {
          throwSheetsSyncFailure("append rows", appendResult);
        }
        // Promote "pending" → "done" BEFORE updateProgress so a
        // transient BullMQ/Redis error on progress update doesn't trigger a retry
        // that would duplicate the row. Keep it for the manual retry window.
        // Best-effort: do NOT throw on failure.
        await setIdempotencyKey(
          idempotencyKey,
          DONE_IDEMPOTENCY_TTL_SECONDS,
          "done",
        ).catch((e: unknown) => {
          console.warn(
            `[sheets-sync] Could not persist idempotency key ${idempotencyKey}: ${e instanceof Error ? e.message : e}`,
          );
        });

        await job.updateProgress(100).catch(() => {
          // Best-effort progress update; job result is what matters.
        });

        return {
          ok: true,
          provider: "google-sheets",
          jobId: job.id,
          updatedRange: appendResult.data.updatedRange,
          updatedRows: appendResult.data.updatedRows,
        };
      }
    },
    // Lock TTL covers a full pending-idempotency wait followed by the Sheets
    // critical section (2 reads + 1 conditional header update + 1 append).
    {
      ttlMs: SHEETS_SYNC_LOCK_TTL_MS,
      waitTimeoutMs: SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS,
      signal: workerShutdownSignal,
    },
  );
};

/**
 * カラムインデックス（0-based）を Google Sheets のカラム文字（A, B, ..., Z, AA, ...）に変換する。
 * e.g. 0→"A", 1→"B", 25→"Z", 26→"AA"
 */
function columnIndexToLetter(index: number): string {
  let letter = "";
  let i = index;
  do {
    letter = String.fromCharCode(65 + (i % 26)) + letter;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return letter;
}

async function readSheetForIdempotency(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    sheetName: string;
    responseId: string;
  },
): Promise<{ ok: true; exists: boolean; headers: string[] }> {
  const headerData = await readRange(token, {
    spreadsheetId: params.spreadsheetId,
    rangeA1: `${params.sheetName}!1:1`,
  });
  if (!headerData.ok) {
    throwSheetsSyncFailure("read sheet for idempotency check", headerData);
  }
  if (headerData.data.values.length === 0) {
    return { ok: true, exists: false, headers: [] };
  }

  const headers = headerData.data.values[0] ?? [];
  const responseIdIndex = headers.indexOf(RESPONSE_ID_HEADER);
  if (responseIdIndex === -1) {
    return { ok: true, exists: false, headers };
  }

  const columnLetter = columnIndexToLetter(responseIdIndex);
  const entireColumn = await readRange(token, {
    spreadsheetId: params.spreadsheetId,
    rangeA1: `${params.sheetName}!${columnLetter}:${columnLetter}`,
  });
  if (!entireColumn.ok) {
    throwSheetsSyncFailure(
      "read sheet column for idempotency check",
      entireColumn,
    );
  }

  const exists = entireColumn.data.values
    .slice(1)
    .some((row) => row[0] === params.responseId);
  return { ok: true, exists, headers };
}

async function waitForPendingIdempotencyToResolve(
  idempotencyKey: string,
): Promise<"done" | "expired"> {
  while (true) {
    const ttlMs = await getIdempotencyKeyTtlMs(idempotencyKey);
    if (ttlMs === -1) {
      throw new Error(
        `[sheets-sync] Pending idempotency key ${idempotencyKey} has no TTL`,
      );
    }
    if (ttlMs <= 0) {
      return "expired";
    }

    await sleepForPendingIdempotency(
      Math.min(ttlMs, PENDING_IDEMPOTENCY_POLL_INTERVAL_MS),
    );

    const currentValue = await getIdempotencyKeyValue(idempotencyKey);
    if (currentValue === "done") {
      return "done";
    }
    if (currentValue !== "pending") {
      return "expired";
    }

    const refreshedTtlMs = await getIdempotencyKeyTtlMs(idempotencyKey);
    if (refreshedTtlMs === -1) {
      throw new Error(
        `[sheets-sync] Pending idempotency key ${idempotencyKey} has no TTL`,
      );
    }
    if (refreshedTtlMs <= 0) {
      await sleepForPendingIdempotency(PENDING_IDEMPOTENCY_EXPIRED_SETTLE_MS);
      return "expired";
    }
  }
}

/**
 * レスポンスデータからシート行を構築する
 */
function buildRowFromResponse(
  existingHeaders: string[],
  responseData: Record<string, unknown>,
  blockTitleMap: Map<string, string>,
  responseId: string,
): { headers: string[]; row: string[] } {
  const headers =
    existingHeaders.length > 0 ? [...existingHeaders] : [RESPONSE_ID_HEADER];

  // ヘッダーにResponse IDが含まれていない場合は追加
  if (!headers.includes(RESPONSE_ID_HEADER)) {
    headers.unshift(RESPONSE_ID_HEADER);
  }

  const row: string[] = Array(headers.length).fill("");

  // Response IDを設定
  const responseIdIdx = headers.indexOf(RESPONSE_ID_HEADER);
  if (responseIdIdx >= 0) {
    row[responseIdIdx] = responseId;
  }

  // 各ブロックのデータを行に配置
  for (const [blockId, value] of Object.entries(responseData)) {
    const title = blockTitleMap.get(blockId) ?? blockId;
    let colIdx = headers.indexOf(title);

    if (colIdx === -1) {
      // 新しいカラムを追加
      headers.push(title);
      row.push("");
      colIdx = headers.length - 1;
    }

    row[colIdx] = stringifyValue(value);
  }

  // 行の長さをヘッダーに合わせる
  while (row.length < headers.length) {
    row.push("");
  }

  return { headers, row };
}

/**
 * 値を文字列に変換する
 */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
