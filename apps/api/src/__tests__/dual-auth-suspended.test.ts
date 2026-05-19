import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const getSession = vi.fn();
const validateApiToken = vi.fn();
const validateApiTokenForForm = vi.fn();
const validateApiTokenWithScopes = vi.fn();

class MockSuspendedTokenOwnerError extends Error {
  static readonly MESSAGE = "Your account has been suspended";
}

class MockNonAdminTokenOwnerError extends Error {
  static readonly MESSAGE = "Admin scope requires an active admin owner";
}

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession,
    },
  },
}));

vi.mock("../lib/tokens", () => ({
  NonAdminTokenOwnerError: MockNonAdminTokenOwnerError,
  SuspendedTokenOwnerError: MockSuspendedTokenOwnerError,
  validateApiToken,
  validateApiTokenForForm,
  validateApiTokenWithScopes,
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  form: {},
  formPermission: {},
  formShareLink: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

const { createHonoApp } = await import("../lib/hono");
const { withDualAuth, withDualFormAuth } = await import("../lib/dual-auth");
const { db } = await import("@nexus-form/database");

function mockFormOwnerLookup(userId: string): void {
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi
          .fn()
          .mockResolvedValue([{ id: "form-id", creatorId: userId }]),
      }),
    }),
  } as unknown as ReturnType<typeof db.select>);
}

function createSuspendedSession() {
  return {
    user: {
      id: "suspended-user",
      isSuspended: true,
    },
    session: {
      id: "session-id",
    },
  };
}

describe("suspended users in dual auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects suspended session users for dual auth routes", async () => {
    getSession.mockResolvedValueOnce(createSuspendedSession());
    const app = createHonoApp()
      .use("/secure", withDualAuth())
      .get("/secure", (c) => c.json({ ok: true }));

    const res = await app.request("/secure");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
  });

  it("rejects suspended session users before form permission checks", async () => {
    getSession.mockResolvedValueOnce(createSuspendedSession());
    const app = createHonoApp()
      .use("/forms/:id", withDualFormAuth())
      .get("/forms/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/forms/form-id");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
  });

  it("rejects suspended API token owners with 403", async () => {
    validateApiToken.mockRejectedValueOnce(new MockSuspendedTokenOwnerError());
    const app = createHonoApp()
      .use("/secure", withDualAuth())
      .get("/secure", (c) => c.json({ ok: true }));

    const res = await app.request("/secure", {
      headers: {
        authorization: "Bearer ct_suspended_owner",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
        message: MockSuspendedTokenOwnerError.MESSAGE,
      },
    });
  });

  it("returns 403 when an admin scoped token owner is no longer an admin", async () => {
    validateApiTokenWithScopes.mockRejectedValueOnce(
      new MockNonAdminTokenOwnerError(),
    );
    const app = createHonoApp()
      .use("/admin", withDualAuth(["admin"]))
      .get("/admin", (c) => c.json({ ok: true }));

    const res = await app.request("/admin", {
      headers: {
        authorization: "Bearer ct_demoted_admin",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
  });

  it("returns 403 on form auth when an admin scoped token owner is no longer an admin", async () => {
    validateApiTokenForForm.mockRejectedValueOnce(
      new MockNonAdminTokenOwnerError(),
    );
    const app = createHonoApp()
      .use("/forms/:id", withDualFormAuth("OWNER", ["admin"]))
      .get("/forms/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/forms/form-id", {
      headers: {
        authorization: "Bearer ct_demoted_admin",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(validateApiTokenForForm).toHaveBeenCalledWith(
      "ct_demoted_admin",
      "form-id",
      { rejectAdminOwnerMismatch: true },
    );
  });

  it("rejects suspended API token owners for form routes with 403", async () => {
    validateApiTokenForForm.mockRejectedValueOnce(
      new MockSuspendedTokenOwnerError(),
    );
    const app = createHonoApp()
      .use("/forms/:id", withDualFormAuth())
      .get("/forms/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/forms/form-id", {
      headers: {
        authorization: "Bearer ct_suspended_owner",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
        message: MockSuspendedTokenOwnerError.MESSAGE,
      },
    });
  });

  it("rejects read-only API tokens for editor mutations with 403", async () => {
    validateApiTokenForForm.mockResolvedValueOnce({
      user_id: "token-user",
      token_id: "token-id",
      scopes: ["read"],
      is_admin: false,
    });
    const app = createHonoApp().put(
      "/forms/:id",
      withDualFormAuth("EDITOR"),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/forms/form-id", {
      method: "PUT",
      headers: {
        authorization: "Bearer ct_read_only",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(validateApiTokenForForm).toHaveBeenCalledWith(
      "ct_read_only",
      "form-id",
      { rejectAdminOwnerMismatch: false },
    );
  });

  it("allows write API tokens for editor mutations", async () => {
    validateApiTokenForForm.mockResolvedValueOnce({
      user_id: "token-user",
      token_id: "token-id",
      scopes: ["write"],
      is_admin: false,
    });
    mockFormOwnerLookup("token-user");
    const app = createHonoApp().put(
      "/forms/:id",
      withDualFormAuth("EDITOR"),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/forms/form-id", {
      method: "PUT",
      headers: {
        authorization: "Bearer ct_write",
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(validateApiTokenForForm).toHaveBeenCalledWith(
      "ct_write",
      "form-id",
      { rejectAdminOwnerMismatch: false },
    );
  });

  it("rejects read-only API tokens for viewer-level mutations", async () => {
    validateApiTokenForForm.mockResolvedValueOnce({
      user_id: "token-user",
      token_id: "token-id",
      scopes: ["read"],
      is_admin: false,
    });
    const app = createHonoApp().post(
      "/forms/:id/invitations/:token/accept",
      withDualFormAuth("VIEWER"),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/forms/form-id/invitations/invite/accept", {
      method: "POST",
      headers: {
        authorization: "Bearer ct_read_only",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(validateApiTokenForForm).toHaveBeenCalledWith(
      "ct_read_only",
      "form-id",
      { rejectAdminOwnerMismatch: false },
    );
  });

  it("does not require write scope for viewer GET routes", async () => {
    validateApiTokenForForm.mockResolvedValueOnce({
      user_id: "token-user",
      token_id: "token-id",
      scopes: ["read"],
      is_admin: false,
    });
    mockFormOwnerLookup("token-user");
    const app = createHonoApp().get(
      "/forms/:id",
      withDualFormAuth("VIEWER"),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/forms/form-id", {
      headers: {
        authorization: "Bearer ct_read_only",
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(validateApiTokenForForm).toHaveBeenCalledWith(
      "ct_read_only",
      "form-id",
      { rejectAdminOwnerMismatch: false },
    );
  });
});
