import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const getSession = vi.fn();
const validateApiTokenForUser = vi.fn();

class MockSuspendedTokenOwnerError extends Error {}

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession,
    },
  },
}));

vi.mock("../lib/tokens", () => ({
  createApiToken: vi.fn(),
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
    userId: "userId",
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

describe("POST /api/tokens/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { id: "request-user" },
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
        message: "Your account has been suspended",
        code: "FORBIDDEN",
      },
    });
  });
});
