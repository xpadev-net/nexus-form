/**
 * Google Sheets 同期ハンドラ
 *
 * 新しいフォーム回答をGoogle Sheetsに追記する
 */

import { db, formIntegration, formResponse } from "@nexus-form/database";
import { form } from "@nexus-form/database/schema";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  appendRows,
  readRange,
  updateRange,
} from "../lib/google-sheets-client";
import { getOAuthToken, refreshTokenIfNeeded } from "../lib/oauth-token-store";
import {
  idempotencyKeyExists,
  setIdempotencyKey,
  withRedisLock,
} from "../lib/redis-lock";
import { safeParseResponseData } from "../lib/response-data-extractor";

export type SheetsSyncJob = {
  formId: string;
  integrationId: string;
  responseId: string;
};

const RESPONSE_ID_HEADER = "Response ID";

const GoogleSheetsIntegrationSettingSchema = z.object({
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
});

export const handleSheetsSync = async (job: Job<SheetsSyncJob>) => {
  const { formId, integrationId, responseId } = job.data;

  // 1. Integration設定を取得
  const [integration] = await db
    .select()
    .from(formIntegration)
    .where(eq(formIntegration.id, integrationId))
    .limit(1);

  if (!integration) {
    throw new Error(`Form integration not found: ${integrationId}`);
  }

  const configJson = integration.configJson?.trim();
  if (!configJson) {
    throw new Error("Form integration config_json is empty");
  }

  let rawConfig: Record<string, unknown>;
  try {
    rawConfig = JSON.parse(configJson) as Record<string, unknown>;
  } catch {
    throw new Error("Form integration config_json is not valid JSON");
  }
  const googleSheetsConfig = (rawConfig.googleSheets ?? rawConfig) as Record<
    string,
    unknown
  >;
  const settingResult =
    GoogleSheetsIntegrationSettingSchema.safeParse(googleSheetsConfig);

  if (!settingResult.success) {
    throw new Error(
      `Invalid Google Sheets integration setting: ${JSON.stringify(settingResult.error.issues)}`,
    );
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
    .where(eq(formResponse.id, responseId))
    .limit(1);

  if (!response) {
    throw new Error(`Form response not found: ${responseId}`);
  }

  // 4. フォームのPlateコンテンツからブロックタイトルマップを構築
  const [formRecord] = await db
    .select({ plateContent: form.plateContent })
    .from(form)
    .where(eq(form.id, formId))
    .limit(1);

  const blockTitleMap = new Map<string, string>();
  if (formRecord?.plateContent) {
    try {
      const parsed: unknown = JSON.parse(formRecord.plateContent);
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
      // Idempotency check: skip if this response was already written (e.g. prior
      // attempt wrote the row but crashed before the job completed).
      const idempotencyKey = `sheets-written:${integrationId}:${response.id}`;
      if (await idempotencyKeyExists(idempotencyKey)) {
        return {
          ok: true,
          skipped: true,
          reason: "duplicate",
          provider: "google-sheets",
          jobId: job.id,
        };
      }

      // 5. ヘッダー行を読み取り
      const headerData = await readRange(token, {
        spreadsheetId,
        rangeA1: `${sheetName}!1:1`,
      });

      let existingHeaders: string[] = [];
      if (headerData.ok && headerData.data.values.length > 0) {
        existingHeaders = headerData.data.values[0] ?? [];
      }

      await job.updateProgress(60);

      // 6. レスポンスデータをパース（不正データはスキップして再試行ループを避ける）
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
      await job.updateProgress(100);

      // Mark row as written so retries are idempotent (24h TTL covers all retry windows).
      // Best-effort: if Redis is transiently unavailable here, do NOT throw — the row
      // was already appended, so throwing would only schedule a retry that duplicates it.
      await setIdempotencyKey(idempotencyKey, 86_400).catch((e: unknown) => {
        console.warn(
          `[sheets-sync] Could not persist idempotency key ${idempotencyKey}: ${e instanceof Error ? e.message : e}`,
        );
      });

      return {
        ok: true,
        provider: "google-sheets",
        jobId: job.id,
        updatedRange: appendResult.data.updatedRange,
        updatedRows: appendResult.data.updatedRows,
      };
    },
    // Critical section contains up to 3 sequential Sheets API calls; use a
    // generous TTL so a slow API doesn't expire the lock mid-write.
    { ttlMs: 60_000, waitTimeoutMs: 65_000 },
  );
};

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
