import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  limit: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: mocks.limit,
          })),
        })),
      })),
    })),
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    id: "form.id",
    title: "form.title",
    description: "form.description",
  },
  formInvitation: {},
  formPermission: {},
  formShareLink: {
    id: "formShareLink.id",
    formId: "formShareLink.formId",
    token: "formShareLink.token",
    role: "formShareLink.role",
    isActive: "formShareLink.isActive",
    expiresAt: "formShareLink.expiresAt",
    createdAt: "formShareLink.createdAt",
    updatedAt: "formShareLink.updatedAt",
    createdBy: "formShareLink.createdBy",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  count: vi.fn(() => ({ op: "count" })),
  desc: vi.fn((field: unknown) => ({ op: "desc", field })),
  eq: mocks.eq,
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    op: "inArray",
    field,
    values,
  })),
}));

import { validateShareLink } from "../permission-service";

function shareLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    formId: "form-1",
    token: "share-token",
    role: "VIEWER",
    isActive: true,
    expiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdBy: "user-1",
    formTitle: "Published form",
    formDescription: "Public description",
    ...overrides,
  };
}

describe("validateShareLink", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.limit.mockImplementation(async () => mocks.rows);
    mocks.eq.mockClear();
  });

  it("returns form and link details for an active share link", async () => {
    mocks.rows = [shareLinkRow()];

    await expect(validateShareLink("share-token")).resolves.toEqual({
      form: {
        id: "form-1",
        title: "Published form",
        description: "Public description",
      },
      role: "VIEWER",
      share_link: {
        id: "link-1",
        form_id: "form-1",
        token: "share-token",
        role: "VIEWER",
        is_active: true,
        expires_at: undefined,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        created_by: "user-1",
      },
    });
    expect(mocks.eq).toHaveBeenCalledWith("formShareLink.token", "share-token");
  });

  it("rejects a missing share link", async () => {
    mocks.rows = [];

    await expect(validateShareLink("missing-token")).rejects.toThrow(
      "Share link not found",
    );
  });

  it("rejects an inactive share link", async () => {
    mocks.rows = [shareLinkRow({ isActive: false })];

    await expect(validateShareLink("share-token")).rejects.toThrow(
      "Share link is inactive",
    );
  });

  it("rejects an expired share link", async () => {
    mocks.rows = [shareLinkRow({ expiresAt: new Date("2020-01-01") })];

    await expect(validateShareLink("share-token")).rejects.toThrow(
      "Share link has expired",
    );
  });
});
