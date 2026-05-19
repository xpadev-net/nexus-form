import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthToken } from "../../../types/domain/oauth";
import {
  appendRows,
  getSpreadsheetMetadata,
  insertColumnAtStart,
  insertRowsAtStart,
  readRange,
  updateRange,
} from "../google-sheets-client";

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

function getRequestedUrl(
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex = 0,
): string {
  const url = fetchMock.mock.calls[callIndex]?.[0];
  if (typeof url !== "string") {
    throw new Error("Expected fetch to be called with a string URL");
  }
  return url;
}

const spreadsheetId = "sheet/id with space";
const encodedSpreadsheetId = "sheet%2Fid%20with%20space";

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
        spreadsheetId,
        tableRange: "Sheet 1!A1:B1",
        updates: {
          spreadsheetId,
          updatedRange: "Sheet 1!A1:B1",
          updatedRows: 1,
        },
      }),
    );

    await appendRows(token, {
      spreadsheetId,
      sheetName: "Sheet 1",
      rows: [["a", "b"]],
    });

    expect(getRequestedUrl(fetchMock)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}/values/Sheet%201:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    );
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
      spreadsheetId,
      rangeA1: "Sheet 1!A1:B1",
    });

    expect(getRequestedUrl(fetchMock)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}/values/Sheet%201!A1%3AB1?majorDimension=ROWS`,
    );
  });

  it("encodes spreadsheetId path segments when updating ranges", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ updatedRange: "Sheet 1!A1:B1", updatedRows: 1 }),
    );

    await updateRange(token, {
      spreadsheetId,
      rangeA1: "Sheet 1!A1:B1",
      values: [["a", "b"]],
    });

    expect(getRequestedUrl(fetchMock)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}/values/Sheet%201!A1%3AB1?valueInputOption=RAW`,
    );
  });

  it("encodes spreadsheetId path segments when reading metadata", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ sheets: [] }));

    await getSpreadsheetMetadata(token, spreadsheetId);

    expect(getRequestedUrl(fetchMock)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}?fields=sheets.properties`,
    );
  });

  it("encodes spreadsheetId path segments for batch update helpers", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          sheets: [{ properties: { sheetId: 123, title: "Sheet 1" } }],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ replies: [] }))
      .mockResolvedValueOnce(
        createJsonResponse({
          sheets: [{ properties: { sheetId: 123, title: "Sheet 1" } }],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ replies: [] }));

    await insertColumnAtStart(token, spreadsheetId, "Sheet 1");
    await insertRowsAtStart(token, spreadsheetId, "Sheet 1", 2);

    expect(getRequestedUrl(fetchMock, 1)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}:batchUpdate`,
    );
    expect(getRequestedUrl(fetchMock, 3)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}:batchUpdate`,
    );
  });
});
