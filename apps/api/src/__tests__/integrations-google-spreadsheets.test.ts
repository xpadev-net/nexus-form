import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  dbSelectRows: [] as unknown[],
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mocks.dbSelectRows),
    })),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  formPermission: {},
  googleOAuthToken: {
    accessTokenEnc: "googleOAuthToken.accessTokenEnc",
    expiryDate: "googleOAuthToken.expiryDate",
    refreshTokenEnc: "googleOAuthToken.refreshTokenEnc",
    scopes: "googleOAuthToken.scopes",
    userId: "googleOAuthToken.userId",
  },
}));

vi.mock("../lib/crypto/field-encryption", () => ({
  decryptFromBase64: (value: string) => value,
  encryptToBase64: (value: string) => value,
}));

vi.mock("../lib/dual-auth", () => ({
  withDualAuth:
    () =>
    async (
      c: {
        set: (
          key: string,
          value: { auth_type: "session"; user_id: string },
        ) => void;
      },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "user-1",
      });
      await next();
    },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

const { createHonoApp } = await import("../lib/hono");
const { integrationsGoogleRouter } = await import(
  "../routes/integrations-google"
);

function createApp() {
  return createHonoApp().route(
    "/api/integrations/google",
    integrationsGoogleRouter,
  );
}

function connectedGoogleToken() {
  return {
    accessTokenEnc: "access-token",
    expiryDate: new Date("2030-01-01T00:00:00.000Z"),
    refreshTokenEnc: "refresh-token",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  };
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function createInvalidJsonResponse(): Response {
  return new Response("not-json", {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function createDeferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolveResponse: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return { promise, resolve: resolveResponse };
}

function createAbortableNeverResponse(
  signal: AbortSignal | null,
): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function createHangingJsonResponse(
  status = 200,
  onCancel?: () => void,
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("{"));
      },
      cancel() {
        onCancel?.();
      },
    }),
    {
      headers: { "content-type": "application/json" },
      status,
    },
  );
}

function getFetchJsonBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  if (typeof init?.body !== "string") {
    throw new Error("Expected JSON string request body");
  }
  return JSON.parse(init.body) as unknown;
}

describe("Google Sheets spreadsheet list route", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.dbSelectRows = [connectedGoogleToken()];
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns spreadsheet parent ids and folder paths for duplicate names", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/drive/v3/files?")) {
        return createJsonResponse({
          files: [
            {
              id: "spreadsheet-a",
              name: "Responses",
              parents: ["folder-a"],
            },
            {
              id: "spreadsheet-b",
              name: "Responses",
              parents: ["folder-b"],
            },
          ],
          nextPageToken: "next-page",
        });
      }
      if (url.includes("/drive/v3/files/folder-a?")) {
        return createJsonResponse({
          id: "folder-a",
          mimeType: "application/vnd.google-apps.folder",
          name: "Campaign A",
          parents: ["folder-root"],
        });
      }
      if (url.includes("/drive/v3/files/folder-root?")) {
        return createJsonResponse({
          id: "folder-root",
          mimeType: "application/vnd.google-apps.folder",
          name: "Shared Forms",
        });
      }
      if (url.includes("/drive/v3/files/folder-b?")) {
        return createJsonResponse({
          id: "folder-b",
          mimeType: "application/vnd.google-apps.folder",
          name: "Campaign B",
          parents: ["folder-root"],
        });
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    });
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets?query=Response&pageSize=25&pageToken=cursor-1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      nextPageToken: "next-page",
      spreadsheets: [
        {
          folderPaths: [
            {
              folderIds: ["folder-root", "folder-a"],
              pathSegments: [
                { id: "folder-root", name: "Shared Forms" },
                { id: "folder-a", name: "Campaign A" },
              ],
            },
          ],
          id: "spreadsheet-a",
          itemType: "spreadsheet",
          name: "Responses",
          parents: ["folder-a"],
        },
        {
          folderPaths: [
            {
              folderIds: ["folder-root", "folder-b"],
              pathSegments: [
                { id: "folder-root", name: "Shared Forms" },
                { id: "folder-b", name: "Campaign B" },
              ],
            },
          ],
          id: "spreadsheet-b",
          itemType: "spreadsheet",
          name: "Responses",
          parents: ["folder-b"],
        },
      ],
    });

    const listUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(listUrl.searchParams.get("fields")).toBe(
      "files(id,name,parents),nextPageToken",
    );
    expect(listUrl.searchParams.get("pageSize")).toBe("25");
    expect(listUrl.searchParams.get("pageToken")).toBe("cursor-1");
    expect(listUrl.searchParams.get("q")).toBe(
      "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name contains 'Response'",
    );
    expect(listUrl.searchParams.get("supportsAllDrives")).toBeNull();
    expect(listUrl.searchParams.get("includeItemsFromAllDrives")).toBeNull();
    expect(listUrl.searchParams.get("corpora")).toBeNull();
    expect(listUrl.searchParams.get("driveId")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("clamps spreadsheet list page size to the local maximum", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ files: [] }));
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets?pageSize=500",
    );

    expect(response.status).toBe(200);
    const listUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(listUrl.searchParams.get("pageSize")).toBe("50");
  });

  it("returns empty folder paths for root-level spreadsheets", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        files: [{ id: "spreadsheet-root", name: "Root responses" }],
      }),
    );
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      spreadsheets: [
        {
          folderPaths: [],
          id: "spreadsheet-root",
          itemType: "spreadsheet",
          name: "Root responses",
          parents: [],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const listUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(listUrl.searchParams.get("pageSize")).toBe("50");
  });

  it("bounds folder path metadata depth and parent fan-out", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/drive/v3/files?")) {
        return createJsonResponse({
          files: [
            {
              id: "spreadsheet-a",
              name: "Responses",
              parents: ["folder-1", "folder-extra-a", "folder-extra-b"],
            },
          ],
        });
      }
      const folderMatch = url.match(/\/drive\/v3\/files\/([^?]+)/);
      const folderId = folderMatch?.[1];
      if (folderId === "folder-extra-a") {
        return createJsonResponse({
          id: "folder-extra-a",
          mimeType: "application/vnd.google-apps.folder",
          name: "Extra A",
        });
      }
      const level = folderId?.match(/^folder-(\d+)$/)?.[1];
      if (level) {
        const levelNumber = Number.parseInt(level, 10);
        return createJsonResponse({
          id: `folder-${levelNumber}`,
          mimeType: "application/vnd.google-apps.folder",
          name: `Folder ${levelNumber}`,
          parents: [`folder-${levelNumber + 1}`],
        });
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    });
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.spreadsheets[0].folderPaths).toEqual([
      {
        folderIds: ["folder-5", "folder-4", "folder-3", "folder-2", "folder-1"],
        pathSegments: [
          { id: "folder-5", name: "Folder 5" },
          { id: "folder-4", name: "Folder 4" },
          { id: "folder-3", name: "Folder 3" },
          { id: "folder-2", name: "Folder 2" },
          { id: "folder-1", name: "Folder 1" },
        ],
      },
      {
        folderIds: ["folder-extra-a"],
        pathSegments: [{ id: "folder-extra-a", name: "Extra A" }],
      },
    ]);
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/drive/v3/files/folder-extra-b?"),
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/drive/v3/files/folder-6?"),
      ),
    ).toBe(false);
  });

  it("fetches sibling folder paths without serializing spreadsheet rows", async () => {
    const folderA = createDeferredResponse();
    const folderB = createDeferredResponse();
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          files: [
            {
              id: "spreadsheet-a",
              name: "Responses A",
              parents: ["folder-a"],
            },
            {
              id: "spreadsheet-b",
              name: "Responses B",
              parents: ["folder-b"],
            },
          ],
        }),
      )
      .mockReturnValueOnce(folderA.promise)
      .mockReturnValueOnce(folderB.promise);
    const app = createApp();

    const responsePromise = app.request(
      "/api/integrations/google/spreadsheets",
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    folderA.resolve(
      createJsonResponse({
        id: "folder-a",
        mimeType: "application/vnd.google-apps.folder",
        name: "Folder A",
      }),
    );
    folderB.resolve(
      createJsonResponse({
        id: "folder-b",
        mimeType: "application/vnd.google-apps.folder",
        name: "Folder B",
      }),
    );
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.spreadsheets).toHaveLength(2);
  });

  it("limits concurrent folder metadata requests", async () => {
    const folders = Array.from({ length: 5 }, () => createDeferredResponse());
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/drive/v3/files?")) {
        return Promise.resolve(
          createJsonResponse({
            files: folders.map((_folder, index) => ({
              id: `spreadsheet-${index + 1}`,
              name: `Responses ${index + 1}`,
              parents: [`folder-${index + 1}`],
            })),
          }),
        );
      }
      const folderIndex = Number.parseInt(
        url.match(/\/drive\/v3\/files\/folder-(\d+)\?/)?.[1] ?? "0",
        10,
      );
      return folders[folderIndex - 1]?.promise ?? Promise.reject();
    });
    const app = createApp();

    const responsePromise = app.request(
      "/api/integrations/google/spreadsheets",
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    folders[0]?.resolve(
      createJsonResponse({
        id: "folder-1",
        mimeType: "application/vnd.google-apps.folder",
        name: "Folder 1",
      }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    for (const [index, folder] of folders.entries()) {
      folder.resolve(
        createJsonResponse({
          id: `folder-${index + 1}`,
          mimeType: "application/vnd.google-apps.folder",
          name: `Folder ${index + 1}`,
        }),
      );
    }

    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.spreadsheets).toHaveLength(5);
  });

  it("keeps spreadsheet rows when folder metadata requests time out", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((input, init) => {
        const url = String(input);
        if (url.includes("/drive/v3/files?")) {
          return Promise.resolve(
            createJsonResponse({
              files: Array.from({ length: 5 }, (_value, index) => ({
                id: `spreadsheet-${index + 1}`,
                name: `Responses ${index + 1}`,
                parents: [`folder-${index + 1}`],
              })),
            }),
          );
        }
        return createAbortableNeverResponse(init?.signal ?? null);
      });
      const app = createApp();

      const responsePromise = app.request(
        "/api/integrations/google/spreadsheets",
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
      await vi.advanceTimersByTimeAsync(2_000);

      const response = await responsePromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.spreadsheets).toEqual(
        Array.from({ length: 5 }, (_value, index) => ({
          folderPaths: [],
          id: `spreadsheet-${index + 1}`,
          itemType: "spreadsheet",
          name: `Responses ${index + 1}`,
          parents: [`folder-${index + 1}`],
        })),
      );
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes("/drive/v3/files/folder-5?"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("short-circuits queued folder metadata requests after rate limits", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/drive/v3/files?")) {
        return createJsonResponse({
          files: Array.from({ length: 5 }, (_value, index) => ({
            id: `spreadsheet-${index + 1}`,
            name: `Responses ${index + 1}`,
            parents: [`folder-${index + 1}`],
          })),
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            errors: [{ reason: "rateLimitExceeded" }],
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 403,
        },
      );
    });
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.spreadsheets).toEqual(
      Array.from({ length: 5 }, (_value, index) => ({
        folderPaths: [],
        id: `spreadsheet-${index + 1}`,
        itemType: "spreadsheet",
        name: `Responses ${index + 1}`,
        parents: [`folder-${index + 1}`],
      })),
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/drive/v3/files/folder-5?"),
      ),
    ).toBe(false);
  });

  it("short-circuits queued folder metadata requests when rate-limit bodies time out", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/drive/v3/files?")) {
          return Promise.resolve(
            createJsonResponse({
              files: Array.from({ length: 5 }, (_value, index) => ({
                id: `spreadsheet-${index + 1}`,
                name: `Responses ${index + 1}`,
                parents: [`folder-${index + 1}`],
              })),
            }),
          );
        }
        return Promise.resolve(createHangingJsonResponse(403));
      });
      const app = createApp();

      const responsePromise = app.request(
        "/api/integrations/google/spreadsheets",
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
      await vi.advanceTimersByTimeAsync(2_000);

      const response = await responsePromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.spreadsheets).toEqual(
        Array.from({ length: 5 }, (_value, index) => ({
          folderPaths: [],
          id: `spreadsheet-${index + 1}`,
          itemType: "spreadsheet",
          name: `Responses ${index + 1}`,
          parents: [`folder-${index + 1}`],
        })),
      );
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes("/drive/v3/files/folder-5?"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps spreadsheet rows when folder metadata JSON bodies time out", async () => {
    vi.useFakeTimers();
    try {
      const cancelBodyRead = vi.fn();
      fetchMock.mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/drive/v3/files?")) {
          return Promise.resolve(
            createJsonResponse({
              files: Array.from({ length: 5 }, (_value, index) => ({
                id: `spreadsheet-${index + 1}`,
                name: `Responses ${index + 1}`,
                parents: [`folder-${index + 1}`],
              })),
            }),
          );
        }
        return Promise.resolve(createHangingJsonResponse(200, cancelBodyRead));
      });
      const app = createApp();

      const responsePromise = app.request(
        "/api/integrations/google/spreadsheets",
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
      await vi.advanceTimersByTimeAsync(2_000);

      const response = await responsePromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.spreadsheets).toEqual(
        Array.from({ length: 5 }, (_value, index) => ({
          folderPaths: [],
          id: `spreadsheet-${index + 1}`,
          itemType: "spreadsheet",
          name: `Responses ${index + 1}`,
          parents: [`folder-${index + 1}`],
        })),
      );
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(cancelBodyRead).toHaveBeenCalledTimes(4);
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes("/drive/v3/files/folder-5?"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 502 when fetching spreadsheets cannot reach Google", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch spreadsheet list",
    });
  });

  it("returns 502 when fetching spreadsheets times out", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_input, init) =>
        createAbortableNeverResponse(init?.signal ?? null),
      );
      const app = createApp();

      const responsePromise = app.request(
        "/api/integrations/google/spreadsheets",
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(5_000);

      const response = await responsePromise;

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to fetch spreadsheet list",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 502 when spreadsheet list returns invalid JSON", async () => {
    fetchMock.mockResolvedValueOnce(createInvalidJsonResponse());
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unexpected response from Google API",
    });
  });

  it("keeps spreadsheet rows when fetching folder metadata cannot reach Google", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          files: [
            {
              id: "spreadsheet-a",
              name: "Responses",
              parents: ["folder-a"],
            },
          ],
        }),
      )
      .mockRejectedValueOnce(new Error("network down"));
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spreadsheets: [
        {
          folderPaths: [],
          id: "spreadsheet-a",
          itemType: "spreadsheet",
          name: "Responses",
          parents: ["folder-a"],
        },
      ],
    });
  });

  it("keeps spreadsheet rows when Google returns malformed folder metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          files: [
            {
              id: "spreadsheet-a",
              name: "Responses",
              parents: ["folder-a"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "folder-a",
          mimeType: "application/vnd.google-apps.shortcut",
          name: "Shortcut",
        }),
      );
    const app = createApp();

    const response = await app.request("/api/integrations/google/spreadsheets");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spreadsheets: [
        {
          folderPaths: [],
          id: "spreadsheet-a",
          itemType: "spreadsheet",
          name: "Responses",
          parents: ["folder-a"],
        },
      ],
    });
  });
});

describe("Google Sheets spreadsheet mutation routes", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.dbSelectRows = [connectedGoogleToken()];
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates a spreadsheet using the stored Google token", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        properties: { title: "回答同期" },
        sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
        spreadsheetId: "spreadsheet-1",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-1",
      }),
    );
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "回答同期" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      defaultSheetTitle: "Sheet1",
      spreadsheetId: "spreadsheet-1",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-1",
      title: "回答同期",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sheets.googleapis.com/v4/spreadsheets",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        }),
        method: "POST",
      }),
    );
    expect(getFetchJsonBody(fetchMock)).toEqual({
      properties: { title: "回答同期" },
    });
  });

  it("adds a sheet through spreadsheets.batchUpdate", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        replies: [
          {
            addSheet: {
              properties: {
                sheetId: 123,
                title: "Responses 2026",
              },
            },
          },
        ],
      }),
    );
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets/sheet%2Fid%20with%20space/sheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Responses 2026" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      sheetId: 123,
      title: "Responses 2026",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet%2Fid%20with%20space:batchUpdate",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        }),
        method: "POST",
      }),
    );
    expect(getFetchJsonBody(fetchMock)).toEqual({
      requests: [
        {
          addSheet: {
            properties: { title: "Responses 2026" },
          },
        },
      ],
    });
  });

  it("rejects invalid spreadsheet creation payloads before Google API calls", async () => {
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "" }),
      },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when spreadsheet creation cannot reach Google", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "回答同期" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create spreadsheet",
    });
  });

  it("returns 502 when Google rejects spreadsheet creation", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "回答同期" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create spreadsheet",
    });
  });

  it("returns 502 when spreadsheet creation returns invalid JSON", async () => {
    fetchMock.mockResolvedValueOnce(createInvalidJsonResponse());
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "回答同期" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unexpected response from Google API",
    });
  });

  it.each([
    { replies: "bad" },
    { replies: [] },
  ])("returns 502 when Google returns a malformed add-sheet response %#", async (googleResponse) => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(googleResponse));
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets/spreadsheet-1/sheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Responses" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unexpected response from Google API",
    });
  });

  it("returns 502 when adding a sheet cannot reach Google", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets/spreadsheet-1/sheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Responses" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to add sheet",
    });
  });

  it("returns 502 when Google rejects adding a sheet", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }));
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets/spreadsheet-1/sheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Responses" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to add sheet",
    });
  });

  it("returns 502 when adding a sheet returns invalid JSON", async () => {
    fetchMock.mockResolvedValueOnce(createInvalidJsonResponse());
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/spreadsheets/spreadsheet-1/sheets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Responses" }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unexpected response from Google API",
    });
  });
});
