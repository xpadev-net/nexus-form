import type { OAuthToken } from "../../types/domain/oauth";
import type { GoogleApiError } from "./sheets-drive.types";
import {
  AppendRowsGoogleApiResponseSchema,
  type AppendRowsInput,
  type AppendRowsOutput,
  ReadRangeGoogleApiResponseSchema,
  type ReadRangeInput,
  type ReadRangeOutput,
  type Result,
} from "./sheets-drive.types";

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
  });
  if (!res.ok) {
    // capture retry-after if present and include status in the Error object
    const retryAfter = res.headers.get("retry-after");
    const err = new Error(`Google Sheets API error: ${res.status}`);
    try {
      // attach parsed fields to the error for callers to inspect (typed via intersection)
      const ext = err as unknown as {
        status?: number;
        retryAfterSeconds?: number;
      };
      ext.status = res.status;
      if (retryAfter) ext.retryAfterSeconds = Number(retryAfter);
    } catch {
      // ignore
    }
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function appendRows(
  token: OAuthToken,
  params: AppendRowsInput,
): Promise<Result<AppendRowsOutput>> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(params.sheetName)}:append?valueInputOption=RAW&insertDataOption=${params.insertOption || "INSERT_ROWS"}`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "POST",
      body: {
        values: params.rows,
      },
    });
    const parsed = AppendRowsGoogleApiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "internal",
          message: `Google Sheets API??????: ${JSON.stringify(parsed.error.issues)}`,
        },
      };
    }
    return {
      ok: true,
      data: {
        updatedRange: parsed.data.updates.updatedRange,
        updatedRows: parsed.data.updates.updatedRows ?? 1,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errObj: Partial<GoogleApiError> & {
      code: GoogleApiError["code"];
      message: string;
    } = {
      code: "unknown",
      message,
    };
    if (e && typeof e === "object") {
      const info = e as unknown as {
        status?: number;
        retryAfterSeconds?: number;
        cause?: unknown;
      };
      if (info.status === 429) {
        errObj.code = "rateLimit";
        if (info.retryAfterSeconds)
          errObj.retryAfterSeconds = info.retryAfterSeconds;
      } else if (info.status && info.status >= 500 && info.status < 600) {
        errObj.code = "internal";
      }
      errObj.cause = info.cause ?? undefined;
    }
    return { ok: false, error: errObj as GoogleApiError };
  }
}

export async function readRange(
  token: OAuthToken,
  params: ReadRangeInput,
): Promise<Result<ReadRangeOutput>> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(params.rangeA1)}?majorDimension=${params.majorDimension || "ROWS"}`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "GET",
    });
    const parsed = ReadRangeGoogleApiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "internal",
          message: `Google Sheets readRange??????: ${JSON.stringify(parsed.error.issues)}`,
        },
      };
    }
    return {
      ok: true,
      data: {
        values: parsed.data.values ?? [],
        range: parsed.data.range,
        majorDimension: parsed.data.majorDimension,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errObj: Partial<GoogleApiError> & {
      code: GoogleApiError["code"];
      message: string;
    } = {
      code: "unknown",
      message,
    };
    if (e && typeof e === "object") {
      const info = e as unknown as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (info.status === 429) errObj.code = "rateLimit";
      else if (info.status && info.status >= 500 && info.status < 600)
        errObj.code = "internal";
      if (info.retryAfterSeconds)
        errObj.retryAfterSeconds = info.retryAfterSeconds;
    }
    return { ok: false, error: errObj as GoogleApiError };
  }
}

// update values for a given A1 range
export async function updateRange(
  token: OAuthToken,
  params: import("./sheets-drive.types").UpdateRangeInput,
): Promise<Result<import("./sheets-drive.types").UpdateRangeOutput>> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(
    params.rangeA1,
  )}?valueInputOption=RAW`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "PUT",
      body: { values: params.values },
    });
    // Google returns updates in a slightly different shape; be permissive
    const rawObj = raw as unknown as Record<string, unknown>;
    const updatedRange =
      (rawObj.updatedRange as string | undefined) || params.rangeA1;
    const updatedRows =
      (rawObj.updatedRows as number | undefined) ??
      ((rawObj.updatedCells as number | undefined) ? 1 : undefined);
    return { ok: true, data: { updatedRange, updatedRows } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errObj: Partial<GoogleApiError> & {
      code: GoogleApiError["code"];
      message: string;
    } = {
      code: "unknown",
      message,
    };
    if (e && typeof e === "object") {
      const info = e as unknown as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (info.status === 429) errObj.code = "rateLimit";
      else if (info.status && info.status >= 500 && info.status < 600)
        errObj.code = "internal";
      if (info.retryAfterSeconds)
        errObj.retryAfterSeconds = info.retryAfterSeconds;
    }
    return { ok: false, error: errObj as GoogleApiError };
  }
}

// helper: get spreadsheet metadata (to resolve sheetId by name)
export async function getSpreadsheetMetadata(
  token: OAuthToken,
  spreadsheetId: string,
): Promise<
  Result<{ sheets: Array<{ properties: { sheetId: number; title: string } }> }>
> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  try {
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "GET",
    });
    return {
      ok: true,
      data: raw as unknown as {
        sheets: Array<{ properties: { sheetId: number; title: string } }>;
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errObj: Partial<GoogleApiError> & {
      code: GoogleApiError["code"];
      message: string;
    } = {
      code: "unknown",
      message,
    };
    if (e && typeof e === "object") {
      const info = e as unknown as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (info.status === 429) errObj.code = "rateLimit";
      else if (info.status && info.status >= 500 && info.status < 600)
        errObj.code = "internal";
      if (info.retryAfterSeconds)
        errObj.retryAfterSeconds = info.retryAfterSeconds;
    }
    return { ok: false, error: errObj as GoogleApiError };
  }
}

// helper: insert a column at the start (A) of the given sheet name
export async function insertColumnAtStart(
  token: OAuthToken,
  spreadsheetId: string,
  sheetName: string,
): Promise<Result<import("./sheets-drive.types").BatchUpdateResponse>> {
  // resolve sheetId
  const meta = await getSpreadsheetMetadata(token, spreadsheetId);
  if (!meta.ok) return { ok: false, error: meta.error };
  const match = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!match) {
    return {
      ok: false,
      error: { code: "notFound", message: `sheet not found: ${sheetName}` },
    };
  }
  const sheetId = match.properties.sheetId;
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  try {
    const body = {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 1,
            },
            inheritFromBefore: false,
          },
        },
      ],
    };
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "POST",
      body,
    });
    return {
      ok: true,
      data: raw as unknown as import("./sheets-drive.types").BatchUpdateResponse,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errObj: Partial<GoogleApiError> & {
      code: GoogleApiError["code"];
      message: string;
    } = {
      code: "unknown",
      message,
    };
    if (e && typeof e === "object") {
      const info = e as unknown as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (info.status === 429) errObj.code = "rateLimit";
      else if (info.status && info.status >= 500 && info.status < 600)
        errObj.code = "internal";
      if (info.retryAfterSeconds)
        errObj.retryAfterSeconds = info.retryAfterSeconds;
    }
    return { ok: false, error: errObj as GoogleApiError };
  }
}

// helper: insert rows at the start (top) of the given sheet name
export async function insertRowsAtStart(
  token: OAuthToken,
  spreadsheetId: string,
  sheetName: string,
  rowCount: number,
): Promise<Result<import("./sheets-drive.types").BatchUpdateResponse>> {
  const meta = await getSpreadsheetMetadata(token, spreadsheetId);
  if (!meta.ok) return { ok: false, error: meta.error };
  const match = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!match) {
    return {
      ok: false,
      error: { code: "notFound", message: `sheet not found: ${sheetName}` },
    };
  }
  const sheetId = match.properties.sheetId;
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  try {
    const body = {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 0,
              endIndex: rowCount,
            },
            inheritFromBefore: false,
          },
        },
      ],
    };
    const raw = await fetchGoogleSheetsAPI({
      accessToken: token.accessToken,
      endpoint,
      method: "POST",
      body,
    });
    return {
      ok: true,
      data: raw as unknown as import("./sheets-drive.types").BatchUpdateResponse,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errObj: Partial<GoogleApiError> & {
      code: GoogleApiError["code"];
      message: string;
    } = {
      code: "unknown",
      message,
    };
    if (e && typeof e === "object") {
      const info = e as unknown as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (info.status === 429) errObj.code = "rateLimit";
      else if (info.status && info.status >= 500 && info.status < 600)
        errObj.code = "internal";
      if (info.retryAfterSeconds)
        errObj.retryAfterSeconds = info.retryAfterSeconds;
    }
    return { ok: false, error: errObj as GoogleApiError };
  }
}
