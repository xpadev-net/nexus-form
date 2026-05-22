import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsufficientFormPermissionError } from "../../errors/form-errors";

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  invitationLimit: vi.fn(),
  permissionLimit: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(async (callback) => {
      const select = vi.fn(() => {
        return {
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({ limit: mocks.invitationLimit })),
            })),
            where: vi.fn(() => ({
              for: vi.fn(() => ({
                limit: mocks.permissionLimit,
              })),
              limit: mocks.invitationLimit,
            })),
          })),
        };
      });

      return callback({
        select,
        delete: vi.fn(() => ({
          where: mocks.deleteWhere,
        })),
      });
    }),
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    creatorId: "form.creatorId",
    id: "form.id",
  },
  formIntegration: {},
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
  formShareLink: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  count: vi.fn(),
  desc: vi.fn(),
  eq: mocks.eq,
  inArray: vi.fn(),
}));

import { cancelInvitation } from "../permission-service";

function pendingInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "invitation-1",
    formId: "form-1",
    invitedBy: "editor-1",
    status: "PENDING",
    formCreatorId: "owner-1",
    ...overrides,
  };
}

describe("cancelInvitation current permission checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invitationLimit.mockResolvedValue([pendingInvitation()]);
    mocks.permissionLimit.mockResolvedValue([{ role: "EDITOR" }]);
    mocks.deleteWhere.mockResolvedValue(undefined);
  });

  it("allows a current inviter permission holder to cancel their invitation", async () => {
    await cancelInvitation("invitation-1", "editor-1", "form-1");

    expect(mocks.permissionLimit).toHaveBeenCalledTimes(1);
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.userId", "editor-1");
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("rejects the original inviter after their form permission is removed", async () => {
    mocks.permissionLimit.mockResolvedValueOnce([]);

    await expect(
      cancelInvitation("invitation-1", "editor-1", "form-1"),
    ).rejects.toBeInstanceOf(InsufficientFormPermissionError);
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });

  it("rejects the original inviter after their form permission is downgraded to viewer", async () => {
    mocks.permissionLimit.mockResolvedValueOnce([{ role: "VIEWER" }]);

    await expect(
      cancelInvitation("invitation-1", "editor-1", "form-1"),
    ).rejects.toBeInstanceOf(InsufficientFormPermissionError);
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });

  it("allows the current form owner without an inviter permission row", async () => {
    mocks.invitationLimit.mockResolvedValueOnce([
      pendingInvitation({ formCreatorId: "owner-1", invitedBy: "editor-1" }),
    ]);
    mocks.permissionLimit.mockResolvedValueOnce([]);

    await cancelInvitation("invitation-1", "owner-1", "form-1");

    expect(mocks.permissionLimit).not.toHaveBeenCalled();
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });
});
