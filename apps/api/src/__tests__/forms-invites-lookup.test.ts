import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  acceptInvitation: vi.fn(),
  authContext: null as { auth_type: "session"; user_id: string } | null,
  InvitationAcceptError: class InvitationAcceptError extends Error {
    constructor(
      readonly code: string,
      readonly statusCode: 403 | 404 | 409 | 410,
      message: string,
    ) {
      super(message);
      this.name = "InvitationAcceptError";
    }
  },
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
  InvitationAcceptError: mocks.InvitationAcceptError,
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
        json: (body: unknown, status?: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      if (!mocks.authContext) {
        return c.json({ error: { message: "Unauthorized" } }, 401);
      }
      c.set("dualAuthContext", mocks.authContext);
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
    mocks.authContext = { auth_type: "session", user_id: "user-1" };
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

  it("maps cancelled invitations to 410 when an inviter lost authority before acceptance", async () => {
    const app = createApp();
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";
    mocks.acceptInvitation.mockRejectedValueOnce(
      new mocks.InvitationAcceptError(
        "INVITATION_NOT_PENDING",
        410,
        "Invitation has been cancelled",
      ),
    );

    const response = await app.request(`/api/forms/invites/${token}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Invitation has been cancelled",
    });
  });

  it("maps revoked inviter authority to 403 during invitation acceptance", async () => {
    const app = createApp();
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";
    mocks.acceptInvitation.mockRejectedValueOnce(
      new mocks.InvitationAcceptError(
        "INVITER_PERMISSION_REVOKED",
        403,
        "Inviter no longer has permission to invite users",
      ),
    );

    const response = await app.request(`/api/forms/invites/${token}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Inviter no longer has permission to invite users",
    });
  });

  it("maps conflicting concurrent invitation acceptance to 409", async () => {
    const app = createApp();
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";
    mocks.acceptInvitation.mockRejectedValueOnce(
      new mocks.InvitationAcceptError(
        "INVITATION_ACCEPT_CONFLICT",
        409,
        "Invitation could not be accepted",
      ),
    );

    const response = await app.request(`/api/forms/invites/${token}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Invitation could not be accepted",
    });
  });

  it("rejects unauthenticated callers before accepting canonical invite tokens", async () => {
    mocks.authContext = null;
    const app = createApp();
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";

    const response = await app.request(`/api/forms/invites/${token}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Unauthorized" },
    });
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });
});
