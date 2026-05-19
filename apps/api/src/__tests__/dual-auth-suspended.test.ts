import { describe, expect, it, vi } from "vitest";

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
});
