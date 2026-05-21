import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  permissionLimit: vi.fn(),
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
              where: vi.fn(() => ({ limit: mocks.formLimit })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({ limit: mocks.permissionLimit })),
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
    id: "form.id",
  },
  formInvitation: {},
  formPermission: {
    formId: "formPermission.formId",
    userId: "formPermission.userId",
  },
  formShareLink: {
    createdBy: "formShareLink.createdBy",
    formId: "formShareLink.formId",
    isActive: "formShareLink.isActive",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  count: vi.fn(),
  desc: vi.fn(),
  eq: mocks.eq,
  inArray: vi.fn(),
}));

import { removePermission } from "../permission-service";

describe("removePermission share-link revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([{ id: "form-1" }]);
    mocks.permissionLimit.mockResolvedValue([{ role: "EDITOR" }]);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("deactivates active share links created by the removed user in the same permission removal transaction", async () => {
    await removePermission("form-1", "editor-1");

    expect(mocks.deleteWhere).toHaveBeenCalled();
    expect(mocks.updateSet).toHaveBeenCalledWith({ isActive: false });
    expect(mocks.updateWhere).toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith(
      "formShareLink.createdBy",
      "editor-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.isActive", true);
  });
});
