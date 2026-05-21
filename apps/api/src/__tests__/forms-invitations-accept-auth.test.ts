import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  authContext: null as { auth_type: "session"; user_id: string } | null,
  withDualFormAuth: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {},
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  formInvitation: {},
  formPermission: {},
  formShareLink: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("../lib/dual-auth", () => ({
  withDualAuth: () => {
    return async (
      c: {
        json: (body: unknown, status?: number) => Response;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      if (!mocks.authContext) {
        return c.json({ error: { message: "Unauthorized" } }, 401);
      }
      c.set("dualAuthContext", mocks.authContext);
      await next();
    };
  },
  withDualFormAuth: (role: string) => {
    mocks.withDualFormAuth(role);
    return async (
      c: { json: (body: unknown, status?: number) => Response },
      _next: () => Promise<void>,
    ) => c.json({ error: { message: "Unexpected form auth" } }, 403);
  },
}));

vi.mock("../lib/forms/permission-service", () => ({
  acceptInvitation: mocks.acceptInvitation,
  cancelInvitation: vi.fn(),
  checkShareLinkPermission: vi.fn(),
  createInvitation: vi.fn(),
  createShareLink: vi.fn(),
  deleteShareLink: vi.fn(),
  getFormInvitations: vi.fn(),
  getFormPermissions: vi.fn(),
  getShareLinks: vi.fn(),
  getUserFormPermission: vi.fn(),
  transferOwnership: vi.fn(),
  updatePermissionRole: vi.fn(),
  updateShareLink: vi.fn(),
}));

describe("R11-C3 duplicate form-scoped invitation accept route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.authContext = null;
    mocks.acceptInvitation.mockResolvedValue({
      id: "permission-1",
      form_id: "form-1",
      user_id: "invitee-1",
      role: "VIEWER",
      created_at: "2026-05-21T00:00:00.000Z",
      updated_at: "2026-05-21T00:00:00.000Z",
      user: {
        id: "invitee-1",
        name: "Invitee",
        email: "invitee@example.com",
        discord_id: null,
        created_at: "2026-05-21T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
      },
    });
  });

  it("does not expose the removed form-scoped invitation accept route", async () => {
    mocks.authContext = { auth_type: "session", user_id: "invitee-1" };
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );

    const response = await formsPermissionsRouter.request(
      "/form-1/invitations/invite-token/accept",
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("does not authenticate or accept through the removed route", async () => {
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );

    const response = await formsPermissionsRouter.request(
      "/form-1/invitations/invite-token/accept",
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });
});
