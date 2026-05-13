/**
 * Lightweight Google Sheets REST client using OAuth access token.
 *
 * Provides: getValues (batchGet for a sheet), appendRows, batchUpdateRanges.
 * Retries transient errors with exponential backoff and honours Retry-After when present.
 */

type Row = string[];

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function defaultBackoff(attempt: number, base = 300) {
  const jitter = Math.floor(Math.random() * base);
  return base * 2 ** attempt + jitter;
}

export function createSheetsClient(accessToken: string) {
  if (!accessToken) {
    throw new Error("createSheetsClient: accessToken is required");
  }

  const baseUrl = "https://sheets.googleapis.com/v4/spreadsheets";

  async function request<T>(
    input: RequestInfo,
    init: RequestInit,
    attempts = 5,
  ): Promise<T> {
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(input, init);
        if (res.status === 429 || res.status === 503 || res.status === 500) {
          // Rate limited or server error -> retry
          const ra = res.headers.get("retry-after");
          if (ra) {
            const wait = Number.parseInt(ra, 10);
            if (!Number.isNaN(wait)) await sleep(wait * 1000);
          } else {
            const wait = await defaultBackoff(i);
            await sleep(wait);
          }
          lastErr = new Error(`Transient error ${res.status}`);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Google Sheets API error ${res.status}: ${body}`);
        }
        const json = await res.json();
        return json as T;
      } catch (err) {
        lastErr = err;
        // exponential backoff
        const wait = await defaultBackoff(i);
        // eslint-disable-next-line no-await-in-loop
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  async function getValues(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<{ headers: string[]; rows: Row[] }> {
    // Use batchGet to fetch the full sheet as rows.
    const ranges = encodeURIComponent(sheetName);
    const url = `${baseUrl}/${encodeURIComponent(spreadsheetId)}/values:batchGet?ranges=${ranges}&majorDimension=ROWS`;
    const init: RequestInit = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    };
    const data = await request<{
      valueRanges?: Array<{ values?: string[][] }>;
    }>(url, init);
    const vr = data.valueRanges?.[0]?.values ?? [];
    if (vr.length === 0) return { headers: [], rows: [] };
    const first = vr[0] ?? [];
    const rest = vr.slice(1);
    // If sheet contains multiple header rows, caller will need to handle. Here first row is header.
    return {
      headers: first.map((c) => (c ?? "").toString()),
      rows: rest.map((r) => r.map((c) => (c ?? "").toString())),
    };
  }

  async function appendRows(
    spreadsheetId: string,
    sheetName: string,
    rows: Row[],
    options?: { valueInputOption?: "RAW" | "USER_ENTERED" },
  ): Promise<void> {
    if (rows.length === 0) return;
    const url = `${baseUrl}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=${options?.valueInputOption ?? "RAW"}&insertDataOption=INSERT_ROWS`;
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: rows }),
    };
    // No need to return the inserted range here
    await request(url, init);
  }

  type BatchUpdate = { range: string; values: Row[] };

  async function batchUpdateRanges(
    spreadsheetId: string,
    updates: BatchUpdate[],
    options?: { valueInputOption?: "RAW" | "USER_ENTERED" },
  ) {
    if (updates.length === 0) return;
    const url = `${baseUrl}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
    const body = {
      valueInputOption: options?.valueInputOption ?? "RAW",
      data: updates.map((u) => ({ range: u.range, values: u.values })),
    };
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    };
    await request(url, init);
  }

  return {
    getValues,
    appendRows,
    batchUpdateRanges,
  } as const;
}

export type SheetsClient = ReturnType<typeof createSheetsClient>;
