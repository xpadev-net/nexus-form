import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  countWhere: vi.fn(),
  countWhereArgs: [] as unknown[][],
  pageLimit: vi.fn(),
  pageOffset: vi.fn(),
  pageOrderBy: vi.fn(),
  pageWhere: vi.fn(),
  pageWhereArgs: [] as unknown[][],
}));

const drizzleMocks = vi.hoisted(() => ({
  capturedConditions: [] as Array<{
    strings: TemplateStringsArray;
    values: unknown[];
  }>,
  capturedSql: [] as string[],
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const condition = {
      strings,
      values,
    };
    drizzleMocks.capturedConditions.push(condition);
    drizzleMocks.capturedSql.push(strings.join(""));
    return condition;
  }),
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
    transaction: vi.fn(
      async (callback: (tx: { select: typeof selectMock }) => unknown) =>
        callback({ select: selectMock }),
    ),
    select: vi.fn(selectMock),
  },
}));

function selectMock(fields: { total?: unknown; id?: unknown; name?: unknown }) {
  if ("total" in (fields ?? {})) {
    return {
      from: vi.fn().mockReturnThis(),
      where: dbMocks.countWhere,
    };
  }
  const pageBuilder = {
    from: vi.fn().mockReturnThis(),
    where: dbMocks.pageWhere,
    orderBy: dbMocks.pageOrderBy,
    limit: dbMocks.pageLimit,
    offset: dbMocks.pageOffset,
  };
  dbMocks.pageWhere.mockImplementation((...args: unknown[]) => {
    dbMocks.pageWhereArgs.push(args);
    return pageBuilder;
  });
  dbMocks.pageOrderBy.mockReturnValue(pageBuilder);
  return pageBuilder;
}

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {
    id: "apiToken.id",
    name: "apiToken.name",
    userId: "apiToken.userId",
    isActive: "apiToken.isActive",
    scopes: "apiToken.scopes",
    formIds: "apiToken.formIds",
    expiresAt: "apiToken.expiresAt",
    lastUsedAt: "apiToken.lastUsedAt",
    createdAt: "apiToken.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => "count(*)"),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  sql: drizzleMocks.sql,
}));

const { getUserApiTokens } = await import("../generate");

describe("getUserApiTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.countWhereArgs.length = 0;
    dbMocks.pageWhereArgs.length = 0;
    dbMocks.countWhere.mockImplementation((...args: unknown[]) => {
      dbMocks.countWhereArgs.push(args);
      return Promise.resolve([{ total: 5000 }]);
    });
    dbMocks.pageLimit.mockReturnValue({
      offset: dbMocks.pageOffset,
    });
    dbMocks.pageOffset.mockResolvedValue([]);
  });

  it("drops malformed stored JSON rows that bypass the SQL filter", async () => {
    dbMocks.countWhere.mockResolvedValue([{ total: 2 }]);
    dbMocks.pageOffset.mockResolvedValue([
      tokenRow("token-a"),
      { ...tokenRow("token-bad"), scopes: "not-an-array" },
    ]);

    const result = await getUserApiTokens("user-1", 1, 10);

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.id).toBe("token-a");
    expect("malformed_tokens" in result).toBe(false);
    expect(result.total).toBe(2);
    expect(result.pagination.hasNext).toBe(false);
    expect(dbMocks.countWhere).toHaveBeenCalledOnce();
    expect(dbMocks.pageOffset).toHaveBeenCalledOnce();
  });

  it("uses database pagination for each requested page", async () => {
    dbMocks.countWhere.mockResolvedValue([{ total: 2 }]);
    dbMocks.pageOffset
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
    expect(dbMocks.pageLimit).toHaveBeenNthCalledWith(1, 1);
    expect(dbMocks.pageOffset).toHaveBeenNthCalledWith(1, 0);
    expect(dbMocks.pageLimit).toHaveBeenNthCalledWith(2, 1);
    expect(dbMocks.pageOffset).toHaveBeenNthCalledWith(2, 1);
    expect(dbMocks.pageOrderBy).toHaveBeenCalledWith(
      "apiToken.createdAt",
      "apiToken.id",
    );
  });

  it("loads only one page of full token rows for large lists", async () => {
    dbMocks.pageOffset.mockResolvedValue([tokenRow("token-1")]);

    const result = await getUserApiTokens("user-1", 2, 1);

    expect(dbMocks.countWhere).toHaveBeenCalledOnce();
    expect(dbMocks.pageLimit).toHaveBeenCalledWith(1);
    expect(dbMocks.pageOffset).toHaveBeenCalledWith(1);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.id).toBe("token-1");
    expect(result.total).toBe(5000);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.pageSize).toBe(1);
    expect(result.pagination.totalPages).toBe(5000);
    expect(result.pagination.hasNext).toBe(true);
  });

  it("applies the parseable JSON SQL filter to count and page queries", async () => {
    await getUserApiTokens("user-1", 1, 10);

    const countWhereCondition = dbMocks.countWhereArgs[0]?.[0] as unknown[];
    const pageWhereCondition = dbMocks.pageWhereArgs[0]?.[0] as unknown[];
    const parseableCondition = drizzleMocks.capturedConditions[0];

    expect(countWhereCondition).toContain(parseableCondition);
    expect(pageWhereCondition).toContain(parseableCondition);
  });

  it("applies JSON array shape checks in SQL pagination filter", () => {
    const conditionSql = drizzleMocks.capturedSql[0] ?? "";

    expect(conditionSql).toContain("JSON_SCHEMA_VALID(");
    expect(conditionSql).toContain('"enum":["read","write","admin"]');
    expect(conditionSql).toContain('"maxItems"');
    expect(conditionSql).toContain('"minLength":1');
    expect(
      conditionSql.match(/JSON_SCHEMA_VALID\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });
});
