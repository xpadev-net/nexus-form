import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  countSelect: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn((fields: { count?: unknown }) => {
      if ("count" in (fields ?? {})) {
        return {
          from: vi.fn().mockReturnThis(),
          where: dbMocks.countSelect,
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: dbMocks.limit,
      };
    }),
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
  count: vi.fn(() => "count"),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

const { getUserApiTokens } = await import("../generate");

describe("getUserApiTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.countSelect.mockResolvedValue([{ count: 5000 }]);
    dbMocks.limit.mockImplementation((pageSize: number) => ({
      offset: dbMocks.offset.mockImplementation((offset: number) => {
        const rows = Array.from({ length: pageSize }, (_, index) => ({
          id: `token-${offset + index}`,
          name: `Token ${offset + index}`,
          scopes: ["read"],
          formIds: null,
          expiresAt: null,
          lastUsedAt: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          isActive: true,
        }));
        return Promise.resolve(rows);
      }),
    }));
  });

  it("queries only one page from the database for large token lists", async () => {
    const result = await getUserApiTokens("user-1", 2, 1);

    expect(dbMocks.countSelect).toHaveBeenCalledOnce();
    expect(dbMocks.limit).toHaveBeenCalledWith(1);
    expect(dbMocks.offset).toHaveBeenCalledWith(1);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.id).toBe("token-1");
    expect(result.total).toBe(5000);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.pageSize).toBe(1);
    expect(result.pagination.totalPages).toBe(5000);
  });
});
