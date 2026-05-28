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
import type { Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  appendRows,
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
  getIdempotencyKeyValue,
  setIdempotencyKey,
  withRedisLock,
} from "../lib/redis-lock";
import { safeParseResponseData } from "../lib/response-data-extractor";
import { workerShutdownSignal } from "../lib/shutdown-signal";

export type SheetsSyncJob = SheetsSyncJobData;

const RESPONSE_ID_HEADER = "Response ID";
// Maximum Sheets API calls inside the critical section:
// 2 reads (idempotency check) + 1 conditional header update + 1 append,
// plus one timeout of headroom for slow/late boundary steps.
const SHEETS_SYNC_API_CALLS_IN_CRITICAL_SECTION = 5;
// Add the headroom using the same timeout unit as Sheets API calls.
const SHEETS_SYNC_LOCK_BUFFER_MS = SHEETS_API_TIMEOUT_MS;
const PENDING_IDEMPOTENCY_EXTRA_BUFFER_MS = 30_000;
/** Exported public API: Redis lock TTL in ms; sized from the Sheets API timeout for 5 slots:
 * 2 reads + 1 conditional header update + 1 append + 1 timeout headroom.
 */
export const SHEETS_SYNC_LOCK_TTL_MS =
  SHEETS_API_TIMEOUT_MS * SHEETS_SYNC_API_CALLS_IN_CRITICAL_SECTION +
  SHEETS_SYNC_LOCK_BUFFER_MS;
/** Exported public API: Redis lock wait timeout in ms; must exceed SHEETS_SYNC_LOCK_TTL_MS so contenders can observe completion. */
export const SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS = SHEETS_SYNC_LOCK_TTL_MS + 5_000;
/** Exported public API: pending idempotency TTL in seconds; must outlive the lock TTL plus an extra retry margin. */
export const PENDING_IDEMPOTENCY_TTL_SECONDS = Math.ceil(
  (SHEETS_SYNC_LOCK_TTL_MS + PENDING_IDEMPOTENCY_EXTRA_BUFFER_MS) / 1000,
);
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

  const configJson = integration.configJson?.trim();
  if (!configJson) {
    throw new Error("Form integration config_json is empty");
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(configJson);
  } catch {
    throw new Error("Form integration config_json is not valid JSON");
  }
  const rawConfigResult = IntegrationConfigSchema.safeParse(parsedConfig);
  if (!rawConfigResult.success) {
    throw new Error("Form integration config_json must be an object");
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

  let token = await getOAuthToken(userId);
  if (!token) {
    throw new Error(`OAuth token not found for user: ${userId}`);
  }

  token = await refreshTokenIfNeeded(token);
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

  // 5-9. ロックでシート書き込みを直列化（ヘッダー競合を防ぐ）
  // BullMQ jobId deduplication prevents duplicate concurrent jobs.
  // A Redis idempotency key guards against duplicate rows on BullMQ retries
  // (jobId dedup only applies while the job is still in the queue).
  return await withRedisLock(
    `sheets-sync:${integrationId}`,
    async () => {
      const idempotencyKey = `sheets-written:${integrationId}:${response.id}`;
      const keyValue = await getIdempotencyKeyValue(idempotencyKey);

      if (keyValue === "done") {
        // A prior attempt already wrote the row; skip.
        return {
          ok: true,
          skipped: true,
          reason: "duplicate",
          provider: "google-sheets",
          jobId: job.id,
        };
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
        return {
          ok: true,
          skipped: true,
          reason: "duplicate",
          provider: "google-sheets",
          jobId: job.id,
        };
      };

      if (keyValue === "pending") {
        const sheetCheck = await readSheetForIdempotency(token, {
          spreadsheetId,
          sheetName,
          responseId: response.id,
        });
        if (sheetCheck.exists) {
          return markDuplicateWritten();
        }

        // The lock TTL expired while another job's critical section is still in
        // progress, or the prior attempt crashed before the row was written.
        // Throw so BullMQ retries after the short "pending" TTL expires.
        throw new Error(
          `[sheets-sync] Concurrent write in progress for ${idempotencyKey}; will retry`,
        );
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
      // without the duplicate guard. The TTL exceeds the lock TTL.
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
          throw new Error(
            `Failed to update headers: ${headerUpdateResult.error.message}`,
          );
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
        // レート制限エラーはリトライさせる
        if (appendResult.error.code === "rateLimit") {
          throw new Error(
            `Google Sheets API rate limit: ${appendResult.error.message}`,
          );
        }
        throw new Error(`Failed to append rows: ${appendResult.error.message}`);
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
    },
    // Critical section contains up to 4 sequential Sheets API calls
    // (2 reads + 1 conditional header update + 1 append) plus 1 timeout slot
    // of headroom for slow/late boundary steps.
    // Size the lock from the configured Sheets API timeout plus a buffer so
    // slow successful calls cannot expire the lock mid-write.
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
): Promise<{ exists: boolean; headers: string[] }> {
  const headerData = await readRange(token, {
    spreadsheetId: params.spreadsheetId,
    rangeA1: `${params.sheetName}!1:1`,
  });
  if (!headerData.ok) {
    throw new Error(
      `Failed to read sheet for idempotency check: ${headerData.error.message}`,
    );
  }
  if (headerData.data.values.length === 0) {
    return { exists: false, headers: [] };
  }

  const headers = headerData.data.values[0] ?? [];
  const responseIdIndex = headers.indexOf(RESPONSE_ID_HEADER);
  if (responseIdIndex === -1) {
    return { exists: false, headers };
  }

  const columnLetter = columnIndexToLetter(responseIdIndex);
  const entireColumn = await readRange(token, {
    spreadsheetId: params.spreadsheetId,
    rangeA1: `${params.sheetName}!${columnLetter}:${columnLetter}`,
  });
  if (!entireColumn.ok) {
    throw new Error(
      `Failed to read sheet column for idempotency check: ${entireColumn.error.message}`,
    );
  }

  const exists = entireColumn.data.values
    .slice(1)
    .some((row) => row[0] === params.responseId);
  return { exists, headers };
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
