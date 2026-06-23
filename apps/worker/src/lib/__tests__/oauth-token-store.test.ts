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

function pushExpiredTokenRow() {
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
}

function expiredTokenInput() {
  return {
    userId: "user-1",
    accessToken: "stale-access-token",
    refreshToken: "refresh-token",
    expiryDate: "2000-01-01T00:00:00.000Z",
    scopes: ["old-scope"],
  };
}

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

  it("classifies invalid_grant refresh responses as permanent auth failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
      })),
    );
    pushExpiredTokenRow();

    const {
      OAuthRefreshPermanentAuthError,
      refreshTokenIfNeeded,
      isOAuthRefreshPermanentAuthError,
    } = await import("../oauth-token-store");

    const task = refreshTokenIfNeeded(expiredTokenInput());

    await expect(task).rejects.toBeInstanceOf(OAuthRefreshPermanentAuthError);
    await expect(task).rejects.toMatchObject({
      errorCode: "invalid_grant",
      reason: "invalid_grant",
      status: 400,
    });
    await task.catch((error: unknown) => {
      expect(isOAuthRefreshPermanentAuthError(error)).toBe(true);
    });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("classifies 400 refresh responses as permanent auth failures even when the body is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: "bad request" }),
      })),
    );
    pushExpiredTokenRow();

    const {
      OAuthRefreshPermanentAuthError,
      refreshTokenIfNeeded,
      isOAuthRefreshPermanentAuthError,
    } = await import("../oauth-token-store");

    const task = refreshTokenIfNeeded(expiredTokenInput());

    await expect(task).rejects.toBeInstanceOf(OAuthRefreshPermanentAuthError);
    await expect(task).rejects.toMatchObject({
      reason: "bad_request",
      status: 400,
    });
    await task.catch((error: unknown) => {
      expect(isOAuthRefreshPermanentAuthError(error)).toBe(true);
    });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("classifies 401 refresh responses as permanent auth failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: "invalid_client",
        }),
      })),
    );
    pushExpiredTokenRow();

    const {
      OAuthRefreshPermanentAuthError,
      refreshTokenIfNeeded,
      isOAuthRefreshPermanentAuthError,
    } = await import("../oauth-token-store");

    const task = refreshTokenIfNeeded(expiredTokenInput());

    await expect(task).rejects.toBeInstanceOf(OAuthRefreshPermanentAuthError);
    await expect(task).rejects.toMatchObject({
      errorCode: "invalid_client",
      reason: "unauthorized",
      status: 401,
    });
    await task.catch((error: unknown) => {
      expect(isOAuthRefreshPermanentAuthError(error)).toBe(true);
    });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("keeps 5xx refresh responses retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      })),
    );
    pushExpiredTokenRow();

    const { refreshTokenIfNeeded, isOAuthRefreshPermanentAuthError } =
      await import("../oauth-token-store");

    let caught: unknown;
    try {
      await refreshTokenIfNeeded(expiredTokenInput());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({
      message: "Google token refresh failed: 503",
    });
    expect(isOAuthRefreshPermanentAuthError(caught)).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("keeps 5xx refresh responses retryable even when the error body says invalid_grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          error: "invalid_grant",
        }),
      })),
    );
    pushExpiredTokenRow();

    const { refreshTokenIfNeeded, isOAuthRefreshPermanentAuthError } =
      await import("../oauth-token-store");

    let caught: unknown;
    try {
      await refreshTokenIfNeeded(expiredTokenInput());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({
      message: "Google token refresh failed: 503",
    });
    expect(isOAuthRefreshPermanentAuthError(caught)).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("keeps token refresh timeouts retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      }),
    );
    pushExpiredTokenRow();

    const { refreshTokenIfNeeded, isOAuthRefreshPermanentAuthError } =
      await import("../oauth-token-store");

    let caught: unknown;
    try {
      await refreshTokenIfNeeded(expiredTokenInput());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DOMException);
    expect(caught).toMatchObject({ name: "TimeoutError" });
    expect(isOAuthRefreshPermanentAuthError(caught)).toBe(false);
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
