/**
 * Google Sheets 差分同期ハンドラ
 *
 * スプレッドシートとフォーム回答データの差分を検出し、
 * 追加・更新を行う
 */

import { db, formIntegration, formResponse } from "@nexus-form/database";
import { form } from "@nexus-form/database/schema";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import type { Job } from "bullmq";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  appendRows,
  readRange,
  updateRange,
} from "../lib/google-sheets-client";
import { getOAuthToken, refreshTokenIfNeeded } from "../lib/oauth-token-store";
import { safeParseResponseData } from "../lib/response-data-extractor";

export type GsDiffSyncJob = {
  formId: string;
  integrationId: string;
  fromVersion?: number;
  toVersion?: number;
};

const RESPONSE_ID_HEADER = "Response ID";
const BATCH_SIZE = 100;

const GoogleSheetsIntegrationSettingSchema = z.object({
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
});

export const handleGsDiffSync = async (job: Job<GsDiffSyncJob>) => {
  const { formId, integrationId } = job.data;

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

  const rawConfig = JSON.parse(configJson) as Record<string, unknown>;
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

  // 3. フォームのPlateコンテンツからブロックタイトルマップを構築
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

  // 4. 既存のシートデータを全読み取り
  const sheetData = await readRange(token, {
    spreadsheetId,
    rangeA1: sheetName,
  });

  if (!sheetData.ok) {
    // NotFoundの場合は空として扱う
    if (sheetData.error.code === "notFound") {
      // シートが存在しない: 全レスポンスを追記
      await fullSync(
        token,
        spreadsheetId,
        sheetName,
        formId,
        blockTitleMap,
        job,
      );
      return { ok: true, provider: "google-sheets-diff", jobId: job.id };
    }
    throw new Error(`Failed to read sheet data: ${sheetData.error.message}`);
  }

  const sheetRows = sheetData.data.values;

  // 5. ヘッダー行を解析
  const headerRow = sheetRows[0] ?? [];
  const responseIdColIndex = headerRow.indexOf(RESPONSE_ID_HEADER);

  if (responseIdColIndex === -1 && sheetRows.length === 0) {
    // シートが空: フルシンク
    await fullSync(token, spreadsheetId, sheetName, formId, blockTitleMap, job);
    return { ok: true, provider: "google-sheets-diff", jobId: job.id };
  }

  // 6. 既存のResponse IDを収集
  const existingResponseIds = new Set<string>();
  if (responseIdColIndex >= 0) {
    for (let i = 1; i < sheetRows.length; i++) {
      const row = sheetRows[i];
      const responseIdValue = row?.[responseIdColIndex];
      if (responseIdValue) {
        existingResponseIds.add(responseIdValue);
      }
    }
  }

  // 7. DBから全レスポンスを取得
  const allResponses = await db
    .select()
    .from(formResponse)
    .where(eq(formResponse.formId, formId))
    .orderBy(asc(formResponse.submittedAt));

  // 8. 差分を検出: シートに存在しないレスポンスを追加
  const missingResponses = allResponses.filter(
    (r) => !existingResponseIds.has(r.id),
  );

  if (missingResponses.length === 0) {
    return {
      ok: true,
      provider: "google-sheets-diff",
      jobId: job.id,
      message: "No new responses to sync",
    };
  }

  // 9. バッチで追記
  const headers = headerRow.length > 0 ? [...headerRow] : [RESPONSE_ID_HEADER];

  let totalAdded = 0;

  for (let i = 0; i < missingResponses.length; i += BATCH_SIZE) {
    const batch = missingResponses.slice(i, i + BATCH_SIZE);
    const rows: string[][] = [];

    for (const response of batch) {
      // 不正データはスキップし、1 件の障害がバッチ全体を巻き込まないようにする
      const responseData = safeParseResponseData(
        response.responseDataJson,
        response.id,
      );
      if (!responseData) continue;

      const { headers: newHeaders, row } = buildRowFromResponse(
        headers,
        responseData,
        blockTitleMap,
        response.id,
      );

      // ヘッダーが拡張された場合は反映
      if (newHeaders.length > headers.length) {
        for (let h = headers.length; h < newHeaders.length; h++) {
          headers.push(newHeaders[h] ?? "");
        }
      }

      rows.push(row);
    }

    // バッチ内の全レスポンスが不正データでスキップされた場合は
    // 空の append（API エラーの原因）を避けて次バッチへ進む。
    if (rows.length === 0) {
      await job.updateProgress(
        Math.round(((i + batch.length) / missingResponses.length) * 100),
      );
      continue;
    }

    // ヘッダーが変更された場合は更新
    if (headers.length > headerRow.length || headerRow.length === 0) {
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

    // バッチ内の全行をヘッダー長に合わせてパディング
    for (const row of rows) {
      while (row.length < headers.length) {
        row.push("");
      }
    }

    const appendResult = await appendRows(token, {
      spreadsheetId,
      sheetName,
      rows,
    });

    if (!appendResult.ok) {
      if (appendResult.error.code === "rateLimit") {
        throw new Error(
          `Google Sheets API rate limit: ${appendResult.error.message}`,
        );
      }
      throw new Error(`Failed to append rows: ${appendResult.error.message}`);
    }

    totalAdded += rows.length;

    await job.updateProgress(
      Math.round(((i + batch.length) / missingResponses.length) * 100),
    );
  }

  return {
    ok: true,
    provider: "google-sheets-diff",
    jobId: job.id,
    totalAdded,
    totalResponses: allResponses.length,
  };
};

/**
 * フルシンク: 全レスポンスをシートに書き込む
 */
async function fullSync(
  token: {
    accessToken: string;
    refreshToken: string;
    expiryDate: string;
    userId: string;
    scopes: string[];
  },
  spreadsheetId: string,
  sheetName: string,
  formId: string,
  blockTitleMap: Map<string, string>,
  job: Job<GsDiffSyncJob>,
) {
  const allResponses = await db
    .select()
    .from(formResponse)
    .where(eq(formResponse.formId, formId))
    .orderBy(asc(formResponse.submittedAt));

  if (allResponses.length === 0) {
    return;
  }

  const headers: string[] = [RESPONSE_ID_HEADER];
  const allRows: string[][] = [];

  for (const response of allResponses) {
    // 不正データはスキップし、1 件の障害がバッチ全体を巻き込まないようにする
    const responseData = safeParseResponseData(
      response.responseDataJson,
      response.id,
    );
    if (!responseData) continue;

    const { headers: newHeaders, row } = buildRowFromResponse(
      headers,
      responseData,
      blockTitleMap,
      response.id,
    );

    // ヘッダーが拡張された場合は反映
    if (newHeaders.length > headers.length) {
      for (let h = headers.length; h < newHeaders.length; h++) {
        headers.push(newHeaders[h] ?? "");
      }
    }

    allRows.push(row);
  }

  // ヘッダーを書き込み
  const headerResult = await updateRange(token, {
    spreadsheetId,
    rangeA1: `${sheetName}!1:1`,
    values: [headers],
  });

  if (!headerResult.ok) {
    throw new Error(`Failed to write headers: ${headerResult.error.message}`);
  }

  // バッチで追記
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const appendResult = await appendRows(token, {
      spreadsheetId,
      sheetName,
      rows: batch,
    });

    if (!appendResult.ok) {
      if (appendResult.error.code === "rateLimit") {
        throw new Error(
          `Google Sheets API rate limit: ${appendResult.error.message}`,
        );
      }
      throw new Error(`Failed to append rows: ${appendResult.error.message}`);
    }

    await job.updateProgress(
      Math.round(((i + batch.length) / allRows.length) * 100),
    );
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
  const headers = [...existingHeaders];

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
      headers.push(title);
      row.push("");
      colIdx = headers.length - 1;
    }

    row[colIdx] = stringifyValue(value);
  }

  while (row.length < headers.length) {
    row.push("");
  }

  return { headers, row };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
