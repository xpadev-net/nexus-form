import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  existingLimit: vi.fn(),
  updatedLimit: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(async (callback) => {
      const selectChain = (limit: ReturnType<typeof vi.fn>) => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      });

      return await callback({
        delete: vi.fn(() => ({
          where: mocks.deleteWhere,
        })),
        select: vi
          .fn()
          .mockReturnValueOnce(selectChain(mocks.existingLimit))
          .mockReturnValueOnce(selectChain(mocks.updatedLimit)),
        update: vi.fn(() => ({
          set: mocks.updateSet,
        })),
      });
    }),
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {},
  formIntegration: {},
  formInvitation: {},
  formPermission: {},
  formShareLink: {
    createdAt: "formShareLink.createdAt",
    createdBy: "formShareLink.createdBy",
    expiresAt: "formShareLink.expiresAt",
    formId: "formShareLink.formId",
    id: "formShareLink.id",
    isActive: "formShareLink.isActive",
    role: "formShareLink.role",
    token: "formShareLink.token",
    updatedAt: "formShareLink.updatedAt",
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

import { deleteShareLink, updateShareLink } from "../permission-service";

function shareLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    createdBy: "editor-1",
    expiresAt: null,
    formId: "form-1",
    id: "link-1",
    isActive: true,
    role: "EDITOR",
    token: "secret-token",
    updatedAt: new Date("2026-05-21T01:00:00.000Z"),
    ...overrides,
  };
}

describe("share-link SSE revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingLimit.mockResolvedValue([shareLinkRow()]);
    mocks.updatedLimit.mockResolvedValue([
      shareLinkRow({
        isActive: false,
        updatedAt: new Date("2026-05-21T02:00:00.000Z"),
      }),
    ]);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("revokes share-link token SSE connections when a link is disabled", async () => {
    await updateShareLink("link-1", "form-1", { isActive: false });

    expect(mocks.updateSet).toHaveBeenCalledWith({ isActive: false });
    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", {
      targetType: "share_link",
      shareLinkId: "link-1",
    });
  });

  it("does not revoke share-link token SSE connections when a link stays active", async () => {
    mocks.updatedLimit.mockResolvedValueOnce([
      shareLinkRow({
        isActive: true,
        updatedAt: new Date("2026-05-21T02:00:00.000Z"),
      }),
    ]);

    await updateShareLink("link-1", "form-1", { isActive: true });

    expect(publishSseAccessRevoked).not.toHaveBeenCalled();
  });

  it("revokes share-link token SSE connections when a link is deleted", async () => {
    await deleteShareLink("link-1", "form-1");

    expect(mocks.deleteWhere).toHaveBeenCalled();
    expect(publishSseAccessRevoked).toHaveBeenCalledWith("form-1", {
      targetType: "share_link",
      shareLinkId: "link-1",
    });
  });
});
