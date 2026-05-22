import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  indexSelect: vi.fn(),
  pageSelect: vi.fn(),
}));

const tokenRow = (id: string) => ({
  id,
  name: `Name ${id}`,
  scopes: ["read"],
  formIds: null,
  expiresAt: null,
  lastUsedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  isActive: true,
});

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(
      (fields: { count?: unknown; id?: unknown; name?: unknown }) => {
        if ("id" in (fields ?? {}) && !("name" in (fields ?? {}))) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: dbMocks.indexSelect,
          };
        }
        return {
          from: vi.fn().mockReturnThis(),
          where: dbMocks.pageSelect,
        };
      },
    ),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {
    userId: "apiToken.userId",
    isActive: "apiToken.isActive",
    createdAt: "apiToken.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

const { getUserApiTokens } = await import("../generate");

describe("getUserApiTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.indexSelect.mockResolvedValue(
      Array.from({ length: 5000 }, (_, index) => ({
        id: `token-${index}`,
        scopes: ["read"],
        formIds: null,
      })),
    );
    dbMocks.pageSelect.mockResolvedValue([]);
  });

  it("uses a stable valid-token total when malformed rows are on another page", async () => {
    dbMocks.indexSelect.mockResolvedValue([
      { id: "token-a", scopes: ["read"], formIds: null },
      { id: "token-bad", scopes: "not-an-array", formIds: null },
      { id: "token-b", scopes: ["write"], formIds: null },
    ]);
    dbMocks.pageSelect.mockResolvedValue([tokenRow("token-a")]);

    const result = await getUserApiTokens("user-1", 1, 10);

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.id).toBe("token-a");
    expect(result.malformed_tokens).toEqual([
      { id: "token-bad", error: "MALFORMED_STORED_JSON" },
    ]);
    expect(result.total).toBe(2);
    expect(result.pagination.hasNext).toBe(false);
    expect(dbMocks.pageSelect).toHaveBeenCalledOnce();
  });

  it("pages over valid tokens when malformed rows sit between them", async () => {
    dbMocks.indexSelect.mockResolvedValue([
      { id: "token-a", scopes: ["read"], formIds: null },
      { id: "token-bad", scopes: "not-an-array", formIds: null },
      { id: "token-b", scopes: ["write"], formIds: null },
    ]);
    dbMocks.pageSelect
      .mockResolvedValueOnce([tokenRow("token-a")])
      .mockResolvedValueOnce([tokenRow("token-b")]);

    const page1 = await getUserApiTokens("user-1", 1, 1);
    const page2 = await getUserApiTokens("user-1", 2, 1);

    expect(page1.tokens).toHaveLength(1);
    expect(page1.tokens[0]?.id).toBe("token-a");
    expect(page1.pagination.hasNext).toBe(true);
    expect(page2.tokens).toHaveLength(1);
    expect(page2.tokens[0]?.id).toBe("token-b");
    expect(page2.pagination.hasNext).toBe(false);
    expect(page2.total).toBe(2);
  });

  it("loads only one page of full token rows for large lists", async () => {
    dbMocks.pageSelect.mockResolvedValue([tokenRow("token-1")]);

    const result = await getUserApiTokens("user-1", 2, 1);

    expect(dbMocks.indexSelect).toHaveBeenCalledOnce();
    expect(dbMocks.pageSelect).toHaveBeenCalledOnce();
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.id).toBe("token-1");
    expect(result.total).toBe(5000);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.pageSize).toBe(1);
    expect(result.pagination.totalPages).toBe(5000);
    expect(result.pagination.hasNext).toBe(true);
  });
});
