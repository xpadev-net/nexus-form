import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  currentOwnerLimit: vi.fn(),
  newOwnerLimit: vi.fn(),
  userExistsLimit: vi.fn(),
  insertValues: vi.fn(),
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
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: mocks.formLimit })),
              })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: mocks.newOwnerLimit })),
              })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: mocks.currentOwnerLimit })),
              })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({ limit: mocks.userExistsLimit })),
            })),
          }),
        insert: vi.fn(() => ({
          values: mocks.insertValues,
        })),
        update: vi.fn(() => ({
          set: mocks.updateSet,
        })),
      }),
    ),
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    creatorId: "form.creatorId",
    id: "form.id",
  },
  formIntegration: {
    formId: "formIntegration.formId",
  },
  formInvitation: {},
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

import { transferOwnership } from "../permission-service";

describe("transferOwnership integration ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([
      { creatorId: "old-owner-user-id", id: "form-1" },
    ]);
    mocks.currentOwnerLimit.mockResolvedValue([{ role: "OWNER" }]);
    mocks.newOwnerLimit.mockResolvedValue([{ role: "EDITOR" }]);
    mocks.userExistsLimit.mockResolvedValue([{ id: "new-owner-user-id" }]);
    mocks.insertValues.mockReturnValue({
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mocks.updateSet.mockReturnValue({
      where: mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]),
    });
  });

  it("moves existing integration ownership to the new owner", async () => {
    await transferOwnership("form-1", "new-owner-user-id", "old-owner-user-id");

    const formLockOrder = mocks.formLimit.mock.invocationCallOrder[0] ?? 0;
    const newOwnerLockOrder =
      mocks.newOwnerLimit.mock.invocationCallOrder[0] ?? 0;
    const currentOwnerLockOrder =
      mocks.currentOwnerLimit.mock.invocationCallOrder[0] ?? 0;
    expect(formLockOrder).toBeLessThan(newOwnerLockOrder);
    expect(newOwnerLockOrder).toBeLessThan(currentOwnerLockOrder);
    expect(mocks.updateSet).toHaveBeenCalledWith({
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "EDITOR");
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "OWNER");
    expect(mocks.eq).toHaveBeenCalledWith(
      "form.creatorId",
      "old-owner-user-id",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formIntegration.formId", "form-1");
  });

  it("throws when the target user does not exist", async () => {
    // Make the user existence check return empty.
    mocks.userExistsLimit.mockResolvedValueOnce([]);

    await expect(
      transferOwnership("form-1", "nonexistent-user", "old-owner-user-id"),
    ).rejects.toThrow("New owner user not found");
  });

  it("rejects transfer when form creator and OWNER permission are inconsistent", async () => {
    mocks.formLimit.mockResolvedValueOnce([
      { creatorId: "other-owner-user-id", id: "form-1" },
    ]);

    await expect(
      transferOwnership("form-1", "new-owner-user-id", "old-owner-user-id"),
    ).rejects.toMatchObject({
      code: "OWNER_PERMISSION_INCONSISTENT",
      statusCode: 409,
    });

    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("rejects a stale demotion when the current OWNER role changed before update", async () => {
    mocks.updateWhere
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(
      transferOwnership("form-1", "new-owner-user-id", "old-owner-user-id"),
    ).rejects.toMatchObject({
      code: "PERMISSION_STALE_MUTATION",
      statusCode: 409,
    });

    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "OWNER");
    expect(mocks.updateSet).not.toHaveBeenCalledWith({
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });
  });

  it("rejects a stale promotion when the new owner's role changed before update", async () => {
    mocks.updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(
      transferOwnership("form-1", "new-owner-user-id", "old-owner-user-id"),
    ).rejects.toMatchObject({
      code: "PERMISSION_STALE_MUTATION",
      statusCode: 409,
    });

    expect(mocks.eq).toHaveBeenCalledWith("formPermission.role", "EDITOR");
    expect(mocks.updateSet).not.toHaveBeenCalledWith({
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });
  });
});
