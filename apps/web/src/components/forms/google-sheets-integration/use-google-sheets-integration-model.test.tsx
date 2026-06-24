// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleSheetsIntegrationModel } from "./use-google-sheets-integration-model";
import { useGoogleSheetsIntegrationModel } from "./use-google-sheets-integration-model";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  logError: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiUrl: (path: string) => `http://api.test${path}`,
}));

vi.mock("@/lib/fetch-json", () => {
  class HttpError extends Error {
    status: number;
    body?: unknown;

    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  return {
    fetchJson: mocks.fetchJson,
    HttpError,
  };
});

vi.mock("@/lib/logger", () => ({
  logError: mocks.logError,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("./use-google-oauth", () => ({
  useGoogleOAuth: () => ({
    handleConnect: vi.fn(),
  }),
}));

vi.mock("./use-google-sheets-sync", () => ({
  useGoogleSheetsSync: () => ({
    dismissSyncStatus: vi.fn(),
    isSyncing: false,
    startSync: vi.fn(),
    syncStatus: null,
  }),
}));

function renderWithClient(children: ReactNode): {
  client: QueryClient;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    );
  });

  return { client, root };
}

function HookHarness({
  onState,
}: {
  onState: (state: GoogleSheetsIntegrationModel) => void;
}): null {
  const state = useGoogleSheetsIntegrationModel("form-1");

  useEffect(() => {
    onState(state);
  }, [onState, state]);

  return null;
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForLatestState(
  states: GoogleSheetsIntegrationModel[],
  assertion: (state: GoogleSheetsIntegrationModel) => void,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= 50; attempt += 1) {
    const latestState = states.at(-1);

    try {
      if (!latestState) {
        throw new Error("Expected model state to be captured");
      }

      assertion(latestState);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 50) {
        await flushAsyncWork();
      }
    }
  }

  throw lastError;
}

function jsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected JSON string request body");
  }
  return JSON.parse(init.body) as unknown;
}

function requestUrl(input: unknown): URL {
  if (typeof input !== "string") {
    throw new Error("Expected request URL string");
  }
  return new URL(input);
}

describe("useGoogleSheetsIntegrationModel API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchJson.mockImplementation((input: string, init?: RequestInit) => {
      const url = new URL(input);

      if (
        init?.method === "POST" &&
        url.pathname === "/api/integrations/google/spreadsheets"
      ) {
        return Promise.resolve({
          defaultSheetTitle: "Sheet1",
          spreadsheetId: "spreadsheet-new",
          title: "回答同期",
        });
      }

      if (
        init?.method === "POST" &&
        url.pathname ===
          "/api/integrations/google/spreadsheets/spreadsheet-new/sheets"
      ) {
        return Promise.resolve({
          sheetId: 123,
          title: "Responses 2026",
        });
      }

      if (
        init?.method === "POST" &&
        url.pathname === "/api/forms/form-1/integrations/google-sheets"
      ) {
        return Promise.resolve({
          integration: {
            config: jsonBody(init),
            createdAt: "2026-05-21T00:00:00.000Z",
            formId: "form-1",
            id: "integration-1",
            ownerUserId: "owner-user-id",
            updatedAt: "2026-05-21T00:00:00.000Z",
            userId: "owner-user-id",
          },
        });
      }

      if (url.pathname === "/api/integrations/google/spreadsheets") {
        return Promise.resolve({ spreadsheets: [] });
      }

      if (
        url.pathname ===
        "/api/integrations/google/spreadsheets/spreadsheet-new/sheets"
      ) {
        return Promise.resolve({ sheets: [{ sheetId: 0, title: "Sheet1" }] });
      }

      if (url.pathname === "/api/forms/form-1/integrations/google-sheets") {
        return Promise.resolve({ integration: null });
      }

      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${input}`);
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("uses the API routes and payloads for create, add sheet, and save", async () => {
    const states: GoogleSheetsIntegrationModel[] = [];
    const { client, root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await flushPromises();

    await act(async () => {
      states.at(-1)?.handleNewSpreadsheetTitleChange("回答同期");
    });
    await flushPromises();
    await act(async () => {
      states.at(-1)?.handleCreateSpreadsheetClick();
    });
    await flushPromises();

    expect(states.at(-1)?.selectedSpreadsheetId).toBe("spreadsheet-new");
    expect(states.at(-1)?.selectedSheetName).toBe("Sheet1");

    await act(async () => {
      states.at(-1)?.handleNewSheetTitleChange("Responses 2026");
    });
    await flushPromises();
    await act(async () => {
      states.at(-1)?.handleAddSheetClick();
    });
    await flushPromises();

    expect(states.at(-1)?.selectedSheetName).toBe("Responses 2026");

    await act(async () => {
      states.at(-1)?.handleSaveConfigClick();
    });
    await flushPromises();

    const createCall = mocks.fetchJson.mock.calls.find(([input, init]) => {
      const url = requestUrl(input);
      return (
        init?.method === "POST" &&
        url.pathname === "/api/integrations/google/spreadsheets"
      );
    });
    expect(createCall).toBeDefined();
    expect(jsonBody(createCall?.[1])).toEqual({ title: "回答同期" });

    const spreadsheetListCall = mocks.fetchJson.mock.calls.find(
      ([input, init]) => {
        const url = requestUrl(input);
        return (
          init?.method !== "POST" &&
          url.pathname === "/api/integrations/google/spreadsheets" &&
          url.searchParams.get("pageSize") !== "1"
        );
      },
    );
    expect(spreadsheetListCall).toBeDefined();
    expect(
      requestUrl(spreadsheetListCall?.[0]).searchParams.get("pageSize"),
    ).toBe("21");

    const addSheetCall = mocks.fetchJson.mock.calls.find(([input, init]) => {
      const url = requestUrl(input);
      return (
        init?.method === "POST" &&
        url.pathname ===
          "/api/integrations/google/spreadsheets/spreadsheet-new/sheets"
      );
    });
    expect(addSheetCall).toBeDefined();
    expect(jsonBody(addSheetCall?.[1])).toEqual({ title: "Responses 2026" });

    const saveCall = mocks.fetchJson.mock.calls.find(([input, init]) => {
      const url = requestUrl(input);
      return (
        init?.method === "POST" &&
        url.pathname === "/api/forms/form-1/integrations/google-sheets"
      );
    });
    expect(saveCall).toBeDefined();
    expect(jsonBody(saveCall?.[1])).toEqual({
      headerPolicy: "extend",
      sheetName: "Responses 2026",
      spreadsheetId: "spreadsheet-new",
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["spreadsheets"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["sheets", "spreadsheet-new"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["google-sheets-config", "form-1"],
    });

    act(() => root.unmount());
  });

  it("keeps the selected spreadsheet name when a later search omits it", async () => {
    mocks.fetchJson.mockImplementation((input: string) => {
      const url = new URL(input);

      if (url.pathname === "/api/forms/form-1/integrations/google-sheets") {
        return Promise.resolve({ integration: null });
      }

      if (url.pathname === "/api/integrations/google/spreadsheets") {
        if (url.searchParams.get("pageSize") === "1") {
          return Promise.resolve({
            spreadsheets: [{ id: "connection-check" }],
          });
        }

        if (url.searchParams.get("query") === "no-match") {
          return Promise.resolve({ spreadsheets: [] });
        }

        return Promise.resolve({
          spreadsheets: [
            { id: "spreadsheet-a", name: "Spreadsheet A" },
            { id: "spreadsheet-b", name: "Spreadsheet B" },
          ],
        });
      }

      if (
        url.pathname ===
        "/api/integrations/google/spreadsheets/spreadsheet-a/sheets"
      ) {
        return Promise.resolve({ sheets: [] });
      }

      throw new Error(`Unexpected request: GET ${input}`);
    });

    const states: GoogleSheetsIntegrationModel[] = [];
    const { root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );

    await waitForLatestState(states, (state) => {
      expect(state.filteredSpreadsheets).toEqual([
        { id: "spreadsheet-a", name: "Spreadsheet A" },
        { id: "spreadsheet-b", name: "Spreadsheet B" },
      ]);
    });

    await act(async () => {
      states.at(-1)?.handleSelectSpreadsheet("spreadsheet-a");
    });

    await waitForLatestState(states, (state) => {
      expect(state.selectedSpreadsheetName).toBe("Spreadsheet A");
    });

    await act(async () => {
      states.at(-1)?.handleSearchQueryChange("no-match");
    });

    await waitForLatestState(states, (state) => {
      const hasNoMatchSearchRequest = mocks.fetchJson.mock.calls.some(
        ([input, init]) => {
          const url = requestUrl(input);
          return (
            init?.method !== "POST" &&
            url.pathname === "/api/integrations/google/spreadsheets" &&
            url.searchParams.get("query") === "no-match"
          );
        },
      );

      expect(hasNoMatchSearchRequest).toBe(true);
      expect(state.searchQuery).toBe("no-match");
      expect(state.isFetchingSpreadsheets).toBe(false);
      expect(state.filteredSpreadsheets).toEqual([]);
      expect(state.selectedSpreadsheetId).toBe("spreadsheet-a");
      expect(state.selectedSpreadsheetName).toBe("Spreadsheet A");
    });

    act(() => root.unmount());
  });
});
