import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    id: "form.id",
    title: "form.title",
  },
  formInvitation: {
    id: "formInvitation.id",
    formId: "formInvitation.formId",
    token: "formInvitation.token",
    role: "formInvitation.role",
    status: "formInvitation.status",
    message: "formInvitation.message",
    expiresAt: "formInvitation.expiresAt",
  },
}));

vi.mock("../lib/forms/permission-service", () => ({
  acceptInvitation: mocks.acceptInvitation,
}));

vi.mock("../lib/rate-limit", () => {
  const passThrough = async (
    _c: unknown,
    next: () => Promise<void>,
  ): Promise<void> => {
    await next();
  };
  return {
    createRateLimit: () => passThrough,
    getClientIp: () => "127.0.0.1",
    authRouteRateLimiter: passThrough,
    generalRateLimiter: passThrough,
    invitationSignInRateLimiter: passThrough,
  };
});

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
const { formsInvitesRouter } = await import("../routes/forms-invites");

function createApp() {
  return createHonoApp().route("/api/forms", formsInvitesRouter);
}

function mockInvitationLookup(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  mocks.select.mockReturnValueOnce({ from });
  return { from, innerJoin, where, limit };
}

describe("GET /api/forms/invites/:token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptInvitation.mockResolvedValue({
      id: "permission-1",
      form_id: "form-1",
      user_id: "user-1",
      role: "VIEWER",
      created_at: "2026-05-21T00:00:00.000Z",
      updated_at: "2026-05-21T00:00:00.000Z",
      user: {
        id: "user-1",
        name: "Invitee",
        email: "invitee@example.com",
        discord_id: null,
        created_at: "2026-05-21T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
      },
    });
  });

  it("does not expose the invitation recipient email to unauthenticated callers", async () => {
    const app = createApp();
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";
    mockInvitationLookup([
      {
        id: "invitation-1",
        formId: "form-1",
        formTitle: "Sensitive Form",
        role: "EDITOR",
        status: "PENDING",
        message: "Please join",
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const response = await app.request(`/api/forms/invites/${token}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invitation: {
        id: "invitation-1",
        formId: "form-1",
        formTitle: "Sensitive Form",
        role: "EDITOR",
        status: "PENDING",
        message: "Please join",
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("rejects malformed invite tokens before querying", async () => {
    const app = createApp();

    const response = await app.request("/api/forms/invites/not-an-email");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid invite token",
    });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects malformed accept tokens before accepting", async () => {
    const app = createApp();

    const response = await app.request(
      "/api/forms/invites/not-an-email/accept",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid invite token",
    });
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("accepts valid invite tokens through the canonical invite route", async () => {
    const app = createApp();
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";

    const response = await app.request(`/api/forms/invites/${token}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      permission: {
        id: "permission-1",
        form_id: "form-1",
        user_id: "user-1",
        role: "VIEWER",
        created_at: "2026-05-21T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
        user: {
          id: "user-1",
          name: "Invitee",
          email: "invitee@example.com",
          discord_id: null,
          created_at: "2026-05-21T00:00:00.000Z",
          updated_at: "2026-05-21T00:00:00.000Z",
        },
      },
    });
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(token, "user-1");
  });
});
