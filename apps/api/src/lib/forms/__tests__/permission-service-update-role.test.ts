import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  permissionLimit: vi.fn(),
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
              where: vi.fn(() => ({ limit: mocks.formLimit })),
            })),
          })
          .mockReturnValueOnce({
            from: vi.fn(() => ({
              where: vi.fn(() => ({ limit: mocks.permissionLimit })),
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
    id: "form.id",
  },
  formInvitation: {},
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
    isActive: "formShareLink.isActive",
    role: "formShareLink.role",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  count: vi.fn(),
  desc: vi.fn(),
  eq: mocks.eq,
  inArray: vi.fn(),
}));

const publishSseAccessRevoked = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../redis-publisher", () => ({
  publishSseAccessRevoked,
}));

import { updatePermissionRole } from "../permission-service";

describe("updatePermissionRole share-link revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([{ id: "form-1" }]);
    mocks.permissionLimit.mockResolvedValue([{ role: "EDITOR" }]);
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
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("deactivates active EDITOR share links created by a user downgraded to VIEWER", async () => {
    await updatePermissionRole("form-1", "editor-1", "VIEWER");

    expect(mocks.updateSet).toHaveBeenCalledWith({ role: "VIEWER" });
    expect(mocks.updateSet).toHaveBeenCalledWith({ isActive: false });
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.formId", "form-1");
    expect(mocks.eq).toHaveBeenCalledWith(
      "formShareLink.createdBy",
      "editor-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.isActive", true);
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.role", "EDITOR");
  });

  it("publishes an SSE access revoke event when an EDITOR is downgraded to VIEWER", async () => {
    await updatePermissionRole("form-1", "editor-1", "VIEWER");

    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", "editor-1");
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
});
