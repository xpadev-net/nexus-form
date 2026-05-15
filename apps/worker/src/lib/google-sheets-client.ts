/**
 * Google Sheets API クライアント（Worker用）
 *
 * apps/api/src/lib/google/google-sheets-client.ts のロジックを再利用
 */

import { MAX_TIMER_MS, parsePositiveIntEnv } from "./env";
import type { OAuthToken } from "./oauth-token-store";

/** Google Sheets API 呼び出しのタイムアウト (ms)。 */
const SHEETS_API_TIMEOUT_MS = parsePositiveIntEnv(
  "GOOGLE_SHEETS_API_TIMEOUT_MS",
  30_000,
  MAX_TIMER_MS,
);

export type GoogleApiErrorCode =
  | "rateLimit"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "invalidArgument"
  | "internal"
  | "unknown";

export interface GoogleApiError {
  code: GoogleApiErrorCode;
  message: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export type Result<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: GoogleApiError };

async function fetchGoogleSheetsAPI<T = unknown>(opts: {
  accessToken: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT";
  body?: unknown;
}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(opts.endpoint, {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    // 接続〜レスポンスボディ受信までを含めてタイムアウトさせ、
    // Google 無応答時にワーカーが無期限ブロックするのを防ぐ。
    signal: AbortSignal.timeout(SHEETS_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const err = new Error(`Google Sheets API error: ${res.status}`);
    const ext = err as unknown as {
      status?: number;
      retryAfterSeconds?: number;
    };
    ext.status = res.status;
    if (retryAfter) ext.retryAfterSeconds = Number(retryAfter);
    throw err;
  }
  return res.json() as Promise<T>;
}

function mapApiError(e: unknown): GoogleApiError {
  const message = e instanceof Error ? e.message : String(e);
  const errObj: GoogleApiError = { code: "unknown", message };
  // AbortSignal.timeout() による中断は DOMException("TimeoutError")、
  // 手動中断は "AbortError" を投げる。どちらも一過性の障害として
  // 再試行可能な "internal" に分類する。
  if (
    e instanceof Error &&
    (e.name === "TimeoutError" || e.name === "AbortError")
  ) {
    errObj.code = "internal";
    return errObj;
  }
  if (e && typeof e === "object") {
    const info = e as { status?: number; retryAfterSeconds?: number };
    if (info.status === 429) {
      errObj.code = "rateLimit";
      if (info.retryAfterSeconds)
        errObj.retryAfterSeconds = info.retryAfterSeconds;
    } else if (info.status && info.status >= 500 && info.status < 600) {
      errObj.code = "internal";
    } else if (info.status === 401) {
      errObj.code = "unauthorized";
    } else if (info.status === 403) {
      errObj.code = "forbidden";
    } else if (info.status === 404) {
      errObj.code = "notFound";
    }
    if (info.retryAfterSeconds)
      errObj.retryAfterSeconds = info.retryAfterSeconds;
  }
  return errObj;
}

export async function appendRows(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    sheetName: string;
    rows: string[][];
    insertOption?: "INSERT_ROWS" | "OVERWRITE";
  },
): Promise<Result<{ updatedRange: string; updatedRows: number }>> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(params.sheetName)}:append?valueInputOption=RAW&insertDataOption=${params.insertOption || "INSERT_ROWS"}`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "POST",
      body: { values: params.rows },
    });
    const data = raw as {
      updates: { updatedRange: string; updatedRows?: number };
    };
    return {
      ok: true,
      data: {
        updatedRange: data.updates.updatedRange,
        updatedRows: data.updates.updatedRows ?? 1,
      },
    };
  } catch (e) {
    return { ok: false, error: mapApiError(e) };
  }
}

export async function readRange(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    rangeA1: string;
    majorDimension?: "ROWS" | "COLUMNS";
  },
): Promise<
  Result<{
    values: string[][];
    range: string;
    majorDimension: string;
  }>
> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(params.rangeA1)}?majorDimension=${params.majorDimension || "ROWS"}`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "GET",
    });
    const data = raw as {
      range: string;
      majorDimension: string;
      values?: string[][];
    };
    return {
      ok: true,
      data: {
        values: data.values ?? [],
        range: data.range,
        majorDimension: data.majorDimension,
      },
    };
  } catch (e) {
    return { ok: false, error: mapApiError(e) };
  }
}

export async function updateRange(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    rangeA1: string;
    values: string[][];
  },
): Promise<Result<{ updatedRange: string; updatedRows?: number }>> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(params.rangeA1)}?valueInputOption=RAW`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "PUT",
      body: { values: params.values },
    });
    const rawObj = raw as Record<string, unknown>;
    return {
      ok: true,
      data: {
        updatedRange: (rawObj.updatedRange as string) || params.rangeA1,
        updatedRows: rawObj.updatedRows as number | undefined,
      },
    };
  } catch (e) {
    return { ok: false, error: mapApiError(e) };
  }
}
