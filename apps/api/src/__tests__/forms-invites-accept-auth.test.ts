import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  authContext: null as
    | { auth_type: "session"; user_id: string }
    | { auth_type: "api_token"; user_id: string; scopes: string[] }
    | null,
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
  db: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {},
  formInvitation: {},
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
  };
});

vi.mock("../lib/dual-auth", () => ({
  withDualAuth:
    () =>
    async (
      c: {
        set: (
          key: string,
          value: NonNullable<typeof mocks.authContext>,
        ) => void;
        json: (body: unknown, status?: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      if (!mocks.authContext) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      c.set("dualAuthContext", mocks.authContext);
      await next();
    },
}));

const { createHonoApp } = await import("../lib/hono");
const { formsInvitesRouter } = await import("../routes/forms-invites");

function createApp() {
  return createHonoApp().route("/api/forms", formsInvitesRouter);
}

describe("R12-M1 invite accept session-only auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptInvitation.mockResolvedValue({
      id: "permission-1",
      form_id: "form-1",
      user_id: "user-1",
      role: "VIEWER",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z",
      user: {
        id: "user-1",
        name: "User",
        email: "user@example.com",
        discord_id: null,
        created_at: "2026-05-22T00:00:00.000Z",
        updated_at: "2026-05-22T00:00:00.000Z",
      },
    });
  });

  it("rejects read-only API tokens before accepting an invitation", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "user-1",
      scopes: ["read"],
    };
    const app = createApp();

    const response = await app.request(
      "/api/forms/invites/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/accept",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("allows session users to accept invitations", async () => {
    mocks.authContext = { auth_type: "session", user_id: "user-1" };
    const app = createApp();

    const response = await app.request(
      "/api/forms/invites/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/accept",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "user-1",
    );
  });
});
