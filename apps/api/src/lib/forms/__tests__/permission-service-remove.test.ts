import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  invitationLock: vi.fn(),
  permissionLimit: vi.fn(),
  shareLinkLock: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(async (callback) =>
      callback({
        delete: vi.fn(() => ({
          where: mocks.deleteWhere,
        })),
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
              where: vi.fn(() => ({ for: mocks.shareLinkLock })),
            })),
          }),
        update: vi.fn(() => ({
          set: mocks.updateSet,
        })),
      }),
    ),
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
    formId: "formPermission.formId",
    role: "formPermission.role",
    userId: "formPermission.userId",
  },
  formShareLink: {
    createdBy: "formShareLink.createdBy",
    formId: "formShareLink.formId",
    id: "formShareLink.id",
    isActive: "formShareLink.isActive",
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

import { removePermission } from "../permission-service";

describe("removePermission share-link revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([{ creatorId: "owner-1", id: "form-1" }]);
    mocks.invitationLock.mockResolvedValue([{ id: "invitation-1" }]);
    mocks.permissionLimit.mockResolvedValue([{ role: "EDITOR" }]);
    mocks.shareLinkLock.mockResolvedValue([{ id: "link-1" }]);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("deactivates active share links created by the removed user in the same permission removal transaction", async () => {
    await removePermission("form-1", "editor-1");

    const invitationLockOrder =
      mocks.invitationLock.mock.invocationCallOrder[0] ?? 0;
    const formLockOrder = mocks.formLimit.mock.invocationCallOrder[0] ?? 0;
    const permissionLockOrder =
      mocks.permissionLimit.mock.invocationCallOrder[0] ?? 0;
    expect(invitationLockOrder).toBeLessThan(formLockOrder);
    expect(formLockOrder).toBeLessThan(permissionLockOrder);
    expect(mocks.deleteWhere).toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "EDITOR");
    expect(mocks.updateSet).toHaveBeenCalledWith({ isActive: false });
    expect(mocks.updateWhere).toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith(
      "formShareLink.createdBy",
      "editor-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.isActive", true);
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "CANCELLED" });
    expect(mocks.eq).toHaveBeenCalledWith("formInvitation.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith(
      "formInvitation.invitedBy",
      "editor-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formInvitation.status", "PENDING");
  });

  it("publishes an SSE access revoke event after permission removal", async () => {
    await removePermission("form-1", "editor-1");

    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", {
      targetType: "user",
      userId: "editor-1",
    });
    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", {
      targetType: "share_link",
      shareLinkId: "link-1",
    });
  });

  it("rejects a stale delete when the locked role no longer matches the delete predicate", async () => {
    mocks.deleteWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(removePermission("form-1", "editor-1")).rejects.toMatchObject({
      code: "PERMISSION_STALE_MUTATION",
      statusCode: 409,
    });

    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "EDITOR");
    expect(mocks.updateSet).not.toHaveBeenCalledWith({ isActive: false });
    expect(publishSseAccessRevoked).not.toHaveBeenCalled();
  });
});
