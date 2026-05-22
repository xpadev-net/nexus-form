import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  authContext: null as { auth_type: "session"; user_id: string } | null,
  cancelInvitation: vi.fn(),
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
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", mocks.authContext);
      await next();
    };
  },
}));

vi.mock("../lib/forms/permission-service", () => ({
  cancelInvitation: mocks.cancelInvitation,
  createInvitation: vi.fn(),
  createShareLink: vi.fn(),
  deleteShareLink: vi.fn(),
  getFormInvitations: vi.fn(),
  getFormPermissions: vi.fn(),
  getShareLinks: vi.fn(),
  getUserFormPermission: vi.fn(),
  PermissionRemovalError: class PermissionRemovalError extends Error {},
  removePermission: vi.fn(),
  transferOwnership: vi.fn(),
  updatePermissionRole: vi.fn(),
  updateShareLink: vi.fn(),
  validateShareLinkRole: vi.fn(),
}));

describe("cancel invitation route authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.authContext = { auth_type: "session", user_id: "editor-1" };
    mocks.cancelInvitation.mockResolvedValue(undefined);
  });

  it("returns 403 when the service rejects a stale inviter permission", async () => {
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.cancelInvitation.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-1", "EDITOR", null),
    );

    const response = await formsPermissionsRouter.request(
      "/form-1/invitations/invitation-1",
      { method: "DELETE" },
    );

    await expect(response.json()).resolves.toEqual({
      error: "Insufficient permissions",
    });
    expect(response.status).toBe(403);
    expect(mocks.cancelInvitation).toHaveBeenCalledWith(
      "invitation-1",
      "editor-1",
      "form-1",
    );
  });
});
