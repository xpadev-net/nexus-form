import { describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const getSession = vi.fn();
const validateApiToken = vi.fn();
const validateApiTokenForForm = vi.fn();
const validateApiTokenWithScopes = vi.fn();

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession,
    },
  },
}));

vi.mock("../lib/tokens", () => ({
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
});
