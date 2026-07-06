import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  aggregateAllBlocksInBatches: vi.fn(),
  db: {
    select: vi.fn(),
  },
  fromCalls: [] as Array<unknown>,
  innerJoinCalls: [] as Array<unknown[]>,
  schema: {
    externalServiceValidationResult: {
      responseId: "externalServiceValidationResult.responseId",
      status: "externalServiceValidationResult.status",
    },
    form: {
      id: "form.id",
      plateContent: "form.plateContent",
    },
    formResponse: {
      id: "formResponse.id",
      formId: "formResponse.formId",
      responseDataJson: "formResponse.responseDataJson",
      submittedAt: "formResponse.submittedAt",
      respondentUuid: "formResponse.respondentUuid",
    },
  },
  whereConditions: [] as Array<unknown>,
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus-form/shared")>();
  return {
    ...actual,
    extractQuestionsFromPlateContent: vi.fn(() => []),
  };
});

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
}));

vi.mock("../lib/forms/response-analytics", () => ({
  aggregateAllBlocksInBatches: mocks.aggregateAllBlocksInBatches,
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  count: vi.fn(() => "count"),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  lt: vi.fn((left, right) => ({ op: "lt", left, right })),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
  sql: vi.fn((strings) => ({
    as: vi.fn((alias: string) => ({ alias, strings })),
    toString: () => String(strings[0] ?? "sql"),
  })),
}));

function query(result: unknown[]) {
  const promise = Promise.resolve(result);
  const builder = {
    from: vi.fn((table: unknown) => {
      mocks.fromCalls.push(table);
      return builder;
    }),
    innerJoin: vi.fn((...args: unknown[]) => {
      mocks.innerJoinCalls.push(args);
      return builder;
    }),
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push(condition);
      return builder;
    }),
    groupBy: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable, and this mock must support direct await.
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return builder;
}

describe("response analytics routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.aggregateAllBlocksInBatches.mockReset();
    mocks.aggregateAllBlocksInBatches.mockResolvedValue([]);
    mocks.fromCalls.length = 0;
    mocks.innerJoinCalls.length = 0;
    mocks.whereConditions.length = 0;
  });

  it("counts validation statuses only through rows that still join to FormResponse", async () => {
    mocks.db.select.mockReturnValueOnce(
      query([{ status: "COMPLETED", count: 1 }]),
    );
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/statuses",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      statuses: [{ status: "COMPLETED", count: 1 }],
    });
    expect(mocks.innerJoinCalls).toContainEqual([
      mocks.schema.formResponse,
      {
        op: "eq",
        left: "formResponse.id",
        right: "externalServiceValidationResult.responseId",
      },
    ]);
    expect(mocks.whereConditions).toContainEqual({
      op: "eq",
      left: "formResponse.formId",
      right: "form-1",
    });
  });

  it("reports aggregate counts from the hard-deleted FormResponse set", async () => {
    mocks.db.select
      .mockReturnValueOnce(query([{ count: 1 }]))
      .mockReturnValueOnce(query([{ count: 1 }]));
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/aggregate",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      totalResponses: 1,
      uniqueRespondents: 1,
    });
    expect(mocks.fromCalls).toEqual([
      mocks.schema.formResponse,
      mocks.schema.formResponse,
    ]);
    expect(mocks.whereConditions).toEqual([
      { op: "eq", left: "formResponse.formId", right: "form-1" },
      { op: "eq", left: "formResponse.formId", right: "form-1" },
    ]);
  });

  it("builds timeline counts from current FormResponse rows only", async () => {
    mocks.db.select.mockReturnValueOnce(
      query([{ date: "2026-07-06", count: 1 }]),
    );
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/analytics?page=1&pageSize=20",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      timeline: [{ date: "2026-07-06", count: 1 }],
      pagination: { page: 1, pageSize: 20, hasNext: false },
    });
    expect(mocks.fromCalls).toContain(mocks.schema.formResponse);
    expect(mocks.whereConditions).toContainEqual({
      op: "eq",
      left: "formResponse.formId",
      right: "form-1",
    });
  });

  it("loads block analytics batches from current FormResponse rows only", async () => {
    mocks.db.select
      .mockReturnValueOnce(query([{ plateContent: "[]" }]))
      .mockReturnValueOnce(query([]));
    mocks.aggregateAllBlocksInBatches.mockImplementation(
      async (_formId, _blocks, loadBatch) => {
        await loadBatch(undefined, 100);
        return [];
      },
    );
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/block-analytics",
    );

    expect(res.status).toBe(200);
    expect(mocks.aggregateAllBlocksInBatches).toHaveBeenCalledWith(
      "form-1",
      [],
      expect.any(Function),
    );
    expect(mocks.fromCalls).toContain(mocks.schema.formResponse);
    expect(mocks.whereConditions).toContainEqual(
      expect.objectContaining({
        op: "and",
        conditions: expect.arrayContaining([
          { op: "eq", left: "formResponse.formId", right: "form-1" },
        ]),
      }),
    );
  });
});
