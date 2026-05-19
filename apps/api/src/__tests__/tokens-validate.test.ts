import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const getSession = vi.fn();
const createApiToken = vi.fn();
const validateApiTokenForUser = vi.fn();

class MockSuspendedTokenOwnerError extends Error {
  static readonly MESSAGE = "Your account has been suspended";
}

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession,
    },
  },
}));

vi.mock("../lib/tokens", () => ({
  createApiToken,
  deleteApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  SuspendedTokenOwnerError: MockSuspendedTokenOwnerError,
  validateApiTokenForUser,
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {
    id: "id",
    name: "name",
    scopes: "scopes",
    formIds: "formIds",
    userId: "userId",
    expiresAt: "expiresAt",
    lastUsedAt: "lastUsedAt",
    isActive: "isActive",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

const { tokensRouter } = await import("../routes/tokens");
const { db } = await import("@nexus-form/database");

function mockSelectRowsOnce(rows: Array<Record<string, unknown>>): void {
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as unknown as ReturnType<typeof db.select>);
}

describe("POST /api/tokens/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { id: "request-user", role: "user" },
      session: { id: "session-id" },
    });
  });

  it("returns token details only for tokens owned by the session user", async () => {
    validateApiTokenForUser.mockResolvedValue({
      user_id: "request-user",
      token_id: "token-id",
      scopes: ["read"],
      is_admin: false,
    });

    const res = await tokensRouter.request("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ct_owned" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      valid: true,
      user_id: "request-user",
      scopes: ["read"],
    });
    expect(validateApiTokenForUser).toHaveBeenCalledWith(
      "ct_owned",
      "request-user",
      {
        updateLastUsedAt: false,
      },
    );
  });

  it("does not leak details when the token is not owned by the session user", async () => {
    validateApiTokenForUser.mockResolvedValue(null);

    const res = await tokensRouter.request("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ct_other" }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ valid: false });
    expect(validateApiTokenForUser).toHaveBeenCalledWith(
      "ct_other",
      "request-user",
      {
        updateLastUsedAt: false,
      },
    );
  });

  it("returns 401 without validating a token when there is no session user", async () => {
    getSession.mockResolvedValue(null);

    const res = await tokensRouter.request("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ct_without_session" }),
    });

    expect(res.status).toBe(401);
    expect(validateApiTokenForUser).not.toHaveBeenCalled();
  });

  it("returns 403 when the token owner is suspended", async () => {
    validateApiTokenForUser.mockRejectedValueOnce(
      new MockSuspendedTokenOwnerError(),
    );

    const res = await tokensRouter.request("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ct_suspended" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        message: MockSuspendedTokenOwnerError.MESSAGE,
        code: "FORBIDDEN",
      },
    });
  });
});

describe("POST /api/tokens admin scope authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { id: "request-user", role: "user" },
      session: { id: "session-id" },
    });
  });

  it("rejects admin scope token creation for non-admin sessions", async () => {
    const res = await tokensRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "admin-token",
        scopes: ["admin"],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        message: "Admin scope requires an admin session",
        code: "FORBIDDEN",
      },
    });
    expect(createApiToken).not.toHaveBeenCalled();
  });

  it("allows admin scope token creation for admin sessions", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    getSession.mockResolvedValueOnce({
      user: { id: "admin-user", role: "admin" },
      session: { id: "session-id" },
    });
    createApiToken.mockResolvedValueOnce({
      id: "token-id",
      name: "admin-token",
      token: "ct_admin",
      scopes: ["admin"],
      formIds: undefined,
      expiresAt: undefined,
      createdAt,
    });

    const res = await tokensRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "admin-token",
        scopes: ["admin"],
      }),
    });

    expect(res.status).toBe(201);
    expect(createApiToken).toHaveBeenCalledWith("admin-user", {
      name: "admin-token",
      scopes: ["admin"],
    });
  });

  it("rejects admin scope token updates for non-admin sessions", async () => {
    mockSelectRowsOnce([
      {
        id: "token-id",
        scopes: ["read"],
        formIds: null,
      },
    ]);

    const res = await tokensRouter.request("/token-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopes: ["admin"],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        message: "Admin scope requires an admin session",
        code: "FORBIDDEN",
      },
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects non-scope updates to existing admin tokens for non-admin sessions", async () => {
    mockSelectRowsOnce([
      {
        id: "token-id",
        scopes: ["admin"],
        formIds: null,
      },
    ]);

    const res = await tokensRouter.request("/token-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "renamed",
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        message: "Admin scope requires an admin session",
        code: "FORBIDDEN",
      },
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects scope-downgrades of existing admin tokens for non-admin sessions", async () => {
    mockSelectRowsOnce([
      {
        id: "token-id",
        scopes: ["admin"],
        formIds: null,
      },
    ]);

    const res = await tokensRouter.request("/token-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopes: ["read"],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        message: "Admin scope requires an admin session",
        code: "FORBIDDEN",
      },
    });
    expect(db.update).not.toHaveBeenCalled();
  });
});
