import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  invitationLock: vi.fn(),
  permissionLimit: vi.fn(),
  shareLinkLock: vi.fn(),
  updatedPermissionLimit: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(async (callback) =>
      callback({
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({ for: mocks.invitationLock })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: mocks.formLimit })),
              })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: mocks.permissionLimit })),
              })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({ limit: mocks.updatedPermissionLimit })),
              })),
              where: vi.fn(() => ({ for: mocks.shareLinkLock })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({ limit: mocks.updatedPermissionLimit })),
              })),
            })),
          }),
        update: vi.fn(() => ({
          set: mocks.updateSet,
        })),
      }),
    ),
  },
  user: {
    email: "user.email",
    id: "user.id",
    name: "user.name",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    creatorId: "form.creatorId",
    id: "form.id",
  },
  formInvitation: {
    formId: "formInvitation.formId",
    id: "formInvitation.id",
    invitedBy: "formInvitation.invitedBy",
    status: "formInvitation.status",
  },
  formPermission: {
    createdAt: "formPermission.createdAt",
    formId: "formPermission.formId",
    id: "formPermission.id",
    role: "formPermission.role",
    updatedAt: "formPermission.updatedAt",
    userId: "formPermission.userId",
  },
  formShareLink: {
    createdBy: "formShareLink.createdBy",
    formId: "formShareLink.formId",
    id: "formShareLink.id",
    isActive: "formShareLink.isActive",
    role: "formShareLink.role",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  count: vi.fn(),
  desc: vi.fn(),
  eq: mocks.eq,
  inArray: vi.fn((left: unknown, values: unknown[]) => ({
    op: "inArray",
    left,
    values,
  })),
}));

const publishSseAccessRevoked = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../redis-publisher", () => ({
  publishSseAccessRevoked,
}));

import {
  PermissionUpdateError,
  updatePermissionRole,
} from "../permission-service";

describe("updatePermissionRole share-link revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([{ creatorId: "owner-1", id: "form-1" }]);
    mocks.invitationLock.mockResolvedValue([{ id: "invitation-1" }]);
    mocks.permissionLimit.mockResolvedValue([{ role: "EDITOR" }]);
    mocks.shareLinkLock.mockResolvedValue([{ id: "link-1" }]);
    mocks.updatedPermissionLimit.mockResolvedValue([
      {
        createdAt: new Date("2026-05-21T00:00:00.000Z"),
        formId: "form-1",
        id: "permission-1",
        role: "VIEWER",
        updatedAt: new Date("2026-05-21T01:00:00.000Z"),
        userEmail: "editor@example.com",
        userId: "editor-1",
        userName: "Editor",
      },
    ]);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("deactivates active EDITOR share links created by a user downgraded to VIEWER", async () => {
    await updatePermissionRole("form-1", "editor-1", "VIEWER");

    const invitationLockOrder =
      mocks.invitationLock.mock.invocationCallOrder[0] ?? 0;
    const formLockOrder = mocks.formLimit.mock.invocationCallOrder[0] ?? 0;
    const permissionLockOrder =
      mocks.permissionLimit.mock.invocationCallOrder[0] ?? 0;
    expect(invitationLockOrder).toBeLessThan(formLockOrder);
    expect(formLockOrder).toBeLessThan(permissionLockOrder);
    expect(mocks.updateSet).toHaveBeenCalledWith({ role: "VIEWER" });
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "EDITOR");
    expect(mocks.updateSet).toHaveBeenCalledWith({ isActive: false });
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith(
      "formShareLink.createdBy",
      "editor-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.isActive", true);
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.role", "EDITOR");
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "CANCELLED" });
    expect(mocks.eq).toHaveBeenCalledWith("formInvitation.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith(
      "formInvitation.invitedBy",
      "editor-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formInvitation.status", "PENDING");
  });

  it("publishes an SSE access revoke event when an EDITOR is downgraded to VIEWER", async () => {
    await updatePermissionRole("form-1", "editor-1", "VIEWER");

    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", {
      targetType: "user",
      userId: "editor-1",
    });
    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", {
      targetType: "share_link",
      shareLinkId: "link-1",
    });
  });

  it("does not publish an SSE access revoke event when the role change is not a downgrade", async () => {
    mocks.permissionLimit.mockResolvedValue([{ role: "VIEWER" }]);
    mocks.updatedPermissionLimit.mockResolvedValue([
      {
        createdAt: new Date("2026-05-21T00:00:00.000Z"),
        formId: "form-1",
        id: "permission-1",
        role: "EDITOR",
        updatedAt: new Date("2026-05-21T01:00:00.000Z"),
        userEmail: "editor@example.com",
        userId: "editor-1",
        userName: "Editor",
      },
    ]);

    await updatePermissionRole("form-1", "editor-1", "EDITOR");

    expect(publishSseAccessRevoked).not.toHaveBeenCalled();
  });

  it("rejects a role update when the form no longer exists", async () => {
    mocks.formLimit.mockResolvedValueOnce([]);

    const result = updatePermissionRole("missing-form", "editor-1", "VIEWER");

    await expect(result).rejects.toBeInstanceOf(PermissionUpdateError);
    await expect(result).rejects.toMatchObject({
      code: "FORM_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("rejects a role update when the target permission no longer exists", async () => {
    mocks.permissionLimit.mockResolvedValueOnce([]);

    await expect(
      updatePermissionRole("form-1", "missing-user", "VIEWER"),
    ).rejects.toMatchObject({
      code: "PERMISSION_NOT_FOUND",
      statusCode: 404,
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(publishSseAccessRevoked).not.toHaveBeenCalled();
  });

  it("rejects OWNER permission role changes as conflicts", async () => {
    mocks.permissionLimit.mockResolvedValueOnce([{ role: "OWNER" }]);

    await expect(
      updatePermissionRole("form-1", "owner-1", "VIEWER"),
    ).rejects.toMatchObject({
      code: "OWNER_PERMISSION_UPDATE_FORBIDDEN",
      statusCode: 409,
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(publishSseAccessRevoked).not.toHaveBeenCalled();
  });

  it("rejects a stale role update when the locked role no longer matches the update predicate", async () => {
    mocks.updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(
      updatePermissionRole("form-1", "editor-1", "VIEWER"),
    ).rejects.toMatchObject({
      code: "PERMISSION_STALE_MUTATION",
      statusCode: 409,
    });

    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "EDITOR");
    expect(mocks.updatedPermissionLimit).not.toHaveBeenCalled();
    expect(publishSseAccessRevoked).not.toHaveBeenCalled();
  });
});
