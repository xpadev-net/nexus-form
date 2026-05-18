import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectResults: unknown[][] = [];
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const insertValues = vi.fn();

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  },
  googleOAuthToken: {
    id: "id",
    userId: "userId",
    accessTokenEnc: "accessTokenEnc",
    refreshTokenEnc: "refreshTokenEnc",
  },
}));

vi.mock("../field-encryption", () => ({
  decryptFromBase64: (value: string) => value,
  encryptToBase64: (value: string) => `enc:${value}`,
}));

vi.mock("../redis-lock", () => ({
  withRedisLock: async <T>(
    _key: string,
    operation: () => Promise<T>,
  ): Promise<T> => operation(),
}));

describe("getOAuthToken", () => {
  beforeEach(() => {
    selectResults.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty scope list when stored scopes are malformed", async () => {
    selectResults.push([
      {
        id: "token-id",
        userId: "user-1",
        accessTokenEnc: "access-token",
        refreshTokenEnc: "refresh-token",
        expiryDate: new Date("2030-01-01T00:00:00.000Z"),
        scopes: ["scope-a", 123],
      },
    ]);

    const { getOAuthToken } = await import("../oauth-token-store");

    const result = await getOAuthToken("user-1");

    expect(result).toEqual({
      userId: "user-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiryDate: "2030-01-01T00:00:00.000Z",
      scopes: [],
    });
  });
});

describe("refreshTokenIfNeeded", () => {
  beforeEach(() => {
    selectResults.length = 0;
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
          scope: "scope-a scope-b",
          token_type: "Bearer",
        }),
      })),
    );
    updateWhere.mockResolvedValue(undefined);
    insertValues.mockResolvedValue(undefined);
    updateSet.mockClear();
    updateWhere.mockClear();
    insertValues.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes instead of treating an invalid expiryDate as still valid", async () => {
    selectResults.push(
      [
        {
          id: "token-id",
          userId: "user-1",
          accessTokenEnc: "old-access-token",
          refreshTokenEnc: "refresh-token",
          expiryDate: new Date("2000-01-01T00:00:00.000Z"),
          scopes: ["old-scope"],
        },
      ],
      [{ id: "token-id" }],
    );

    const { refreshTokenIfNeeded } = await import("../oauth-token-store");

    const result = await refreshTokenIfNeeded({
      userId: "user-1",
      accessToken: "stale-access-token",
      refreshToken: "refresh-token",
      expiryDate: "not-a-date",
      scopes: ["old-scope"],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result.accessToken).toBe("new-access-token");
    expect(result.scopes).toEqual(["scope-a", "scope-b"]);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        accessTokenEnc: "enc:new-access-token",
        refreshTokenEnc: "enc:refresh-token",
      }),
    );
  });

  it("rejects malformed Google refresh responses before saving", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          token_type: "Bearer",
        }),
      })),
    );
    selectResults.push([
      {
        id: "token-id",
        userId: "user-1",
        accessTokenEnc: "old-access-token",
        refreshTokenEnc: "refresh-token",
        expiryDate: new Date("2000-01-01T00:00:00.000Z"),
        scopes: ["old-scope"],
      },
    ]);

    const { refreshTokenIfNeeded } = await import("../oauth-token-store");

    await expect(
      refreshTokenIfNeeded({
        userId: "user-1",
        accessToken: "stale-access-token",
        refreshToken: "refresh-token",
        expiryDate: "2000-01-01T00:00:00.000Z",
        scopes: ["old-scope"],
      }),
    ).rejects.toThrow();

    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("refreshes when Google omits the unused token_type field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
          scope: "scope-a scope-b",
        }),
      })),
    );
    selectResults.push(
      [
        {
          id: "token-id",
          userId: "user-1",
          accessTokenEnc: "old-access-token",
          refreshTokenEnc: "refresh-token",
          expiryDate: new Date("2000-01-01T00:00:00.000Z"),
          scopes: ["old-scope"],
        },
      ],
      [{ id: "token-id" }],
    );

    const { refreshTokenIfNeeded } = await import("../oauth-token-store");

    const result = await refreshTokenIfNeeded({
      userId: "user-1",
      accessToken: "stale-access-token",
      refreshToken: "refresh-token",
      expiryDate: "2000-01-01T00:00:00.000Z",
      scopes: ["old-scope"],
    });

    expect(result.accessToken).toBe("new-access-token");
    expect(result.scopes).toEqual(["scope-a", "scope-b"]);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        accessTokenEnc: "enc:new-access-token",
      }),
    );
  });
});
