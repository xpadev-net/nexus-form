import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  currentOwnerLimit: vi.fn(),
  newOwnerLimit: vi.fn(),
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
              where: vi.fn(() => ({ limit: mocks.currentOwnerLimit })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({ limit: mocks.newOwnerLimit })),
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
    id: "form.id",
  },
  formIntegration: {
    formId: "formIntegration.formId",
  },
  formInvitation: {},
  formPermission: {
    formId: "formPermission.formId",
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
    mocks.formLimit.mockResolvedValue([{ id: "form-1" }]);
    mocks.currentOwnerLimit.mockResolvedValue([{ role: "OWNER" }]);
    mocks.newOwnerLimit.mockResolvedValue([{ role: "EDITOR" }]);
    mocks.insertValues.mockReturnValue({
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mocks.updateSet.mockReturnValue({
      where: mocks.updateWhere.mockResolvedValue(undefined),
    });
  });

  it("moves existing integration ownership to the new owner", async () => {
    await transferOwnership("form-1", "new-owner-user-id", "old-owner-user-id");

    expect(mocks.updateSet).toHaveBeenCalledWith({
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });
    expect(mocks.eq).toHaveBeenCalledWith("formIntegration.formId", "form-1");
  });
});
