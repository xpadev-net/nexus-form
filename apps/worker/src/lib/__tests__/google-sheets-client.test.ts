import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendRows, readRange, updateRange } from "../google-sheets-client";
import type { OAuthToken } from "../oauth-token-store";

const token: OAuthToken = {
  userId: "user-1",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiryDate: new Date("2030-01-01T00:00:00.000Z").toISOString(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
};

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function getRequestedUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const url = fetchMock.mock.calls[0]?.[0];
  if (typeof url !== "string") {
    throw new Error("Expected fetch to be called with a string URL");
  }
  return url;
}

describe("google-sheets-client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes spreadsheetId path segments when appending rows", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        updates: { updatedRange: "Sheet 1!A1:B1", updatedRows: 1 },
      }),
    );

    await appendRows(token, {
      spreadsheetId: "sheet/id with space",
      sheetName: "Sheet 1",
      rows: [["a", "b"]],
    });

    expect(getRequestedUrl(fetchMock)).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet%2Fid%20with%20space/values/Sheet%201:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    );
  });

  it("returns an error when append success response is malformed", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        updates: { updatedRange: "Sheet 1!A1:B1", updatedRows: "1" },
      }),
    );

    const result = await appendRows(token, {
      spreadsheetId: "sheet-id",
      sheetName: "Sheet 1",
      rows: [["a", "b"]],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        message: "Google Sheets API returned malformed append response",
      },
    });
  });

  it("keeps append updatedRows fallback when the field is omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        updates: { updatedRange: "Sheet 1!A1:B1" },
      }),
    );

    const result = await appendRows(token, {
      spreadsheetId: "sheet-id",
      sheetName: "Sheet 1",
      rows: [["a", "b"]],
    });

    expect(result).toEqual({
      ok: true,
      data: { updatedRange: "Sheet 1!A1:B1", updatedRows: 1 },
    });
  });

  it("encodes spreadsheetId path segments when reading ranges", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        majorDimension: "ROWS",
        range: "Sheet 1!A1:B1",
        values: [["a", "b"]],
      }),
    );

    await readRange(token, {
      spreadsheetId: "sheet/id with space",
      rangeA1: "Sheet 1!A1:B1",
    });

    expect(getRequestedUrl(fetchMock)).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet%2Fid%20with%20space/values/Sheet%201!A1%3AB1?majorDimension=ROWS",
    );
  });

  it("returns an error when read success values are malformed", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        majorDimension: "ROWS",
        range: "Sheet 1!A1:B1",
        values: "not-an-array",
      }),
    );

    const result = await readRange(token, {
      spreadsheetId: "sheet-id",
      rangeA1: "Sheet 1!A1:B1",
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        message: "Google Sheets API returned malformed read response",
      },
    });
  });

  it("keeps empty read ranges valid when values are omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        majorDimension: "ROWS",
        range: "Sheet 1!A1:B1",
      }),
    );

    const result = await readRange(token, {
      spreadsheetId: "sheet-id",
      rangeA1: "Sheet 1!A1:B1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        majorDimension: "ROWS",
        range: "Sheet 1!A1:B1",
        values: [],
      },
    });
  });

  it("normalizes primitive read cells to strings", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        majorDimension: "ROWS",
        range: "Sheet 1!A1:C1",
        values: [["Response ID", 123, true]],
      }),
    );

    const result = await readRange(token, {
      spreadsheetId: "sheet-id",
      rangeA1: "Sheet 1!A1:C1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        majorDimension: "ROWS",
        range: "Sheet 1!A1:C1",
        values: [["Response ID", "123", "true"]],
      },
    });
  });

  it("encodes spreadsheetId path segments when updating ranges", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ updatedRange: "Sheet 1!A1:B1", updatedRows: 1 }),
    );

    await updateRange(token, {
      spreadsheetId: "sheet/id with space",
      rangeA1: "Sheet 1!A1:B1",
      values: [["a", "b"]],
    });

    expect(getRequestedUrl(fetchMock)).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet%2Fid%20with%20space/values/Sheet%201!A1%3AB1?valueInputOption=RAW",
    );
  });

  it("returns an error when update success response is malformed", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ updatedRange: "Sheet 1!A1:B1", updatedRows: "1" }),
    );

    const result = await updateRange(token, {
      spreadsheetId: "sheet-id",
      rangeA1: "Sheet 1!A1:B1",
      values: [["a", "b"]],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        message: "Google Sheets API returned malformed update response",
      },
    });
  });

  it("returns an error when update success response has no recognized fields", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({}));

    const result = await updateRange(token, {
      spreadsheetId: "sheet-id",
      rangeA1: "Sheet 1!A1:B1",
      values: [["a", "b"]],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        message: "Google Sheets API returned malformed update response",
      },
    });
  });

  it("keeps update range fallback when only updatedRows is present", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ updatedRows: 1 }));

    const result = await updateRange(token, {
      spreadsheetId: "sheet-id",
      rangeA1: "Sheet 1!A1:B1",
      values: [["a", "b"]],
    });

    expect(result).toEqual({
      ok: true,
      data: { updatedRange: "Sheet 1!A1:B1", updatedRows: 1 },
    });
  });
});
