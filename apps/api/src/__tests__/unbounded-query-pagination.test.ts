import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  offsetCalls: [] as number[],
  limitCalls: [] as number[],
  listValidationRules: vi.fn(),
  countValidationRules: vi.fn(),
  formAuthRoles: [] as Array<unknown>,
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  user: {},
  session: {},
  account: {},
  verificationToken: {},
  form: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {
    responseId: "externalServiceValidationResult.responseId",
    status: "externalServiceValidationResult.status",
  },
  fingerprintDetail: {},
  form: {
    id: "form.id",
    plateContent: "form.plateContent",
  },
  formResponse: {
    id: "formResponse.id",
    formId: "formResponse.formId",
    submittedAt: "formResponse.submittedAt",
  },
  formSchedule: {
    id: "formSchedule.id",
    formId: "formSchedule.formId",
    triggerAt: "formSchedule.triggerAt",
  },
  formSnapshot: {
    id: "formSnapshot.id",
    formId: "formSnapshot.formId",
    version: "formSnapshot.version",
    isActive: "formSnapshot.isActive",
    publishedBy: "formSnapshot.publishedBy",
    publishedAt: "formSnapshot.publishedAt",
    changeLog: "formSnapshot.changeLog",
    title: "formSnapshot.title",
    description: "formSnapshot.description",
    parentVersion: "formSnapshot.parentVersion",
  },
  formValidationRule: {},
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: (requiredRole?: unknown) => {
    mocks.formAuthRoles.push(requiredRole);
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  },
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  listValidationRules: mocks.listValidationRules,
  countValidationRules: mocks.countValidationRules,
  createValidationRule: vi.fn(),
  deleteValidationRule: vi.fn(),
  getValidationRule: vi.fn(),
  reorderValidationRules: vi.fn(),
  updateValidationRule: vi.fn(),
  ValidationRuleConfigError: class ValidationRuleConfigError extends Error {},
  ValidationRuleNotFoundError: class ValidationRuleNotFoundError extends Error {},
}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {},
}));

vi.mock("@nexus-form/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus-form/shared")>();
  const { z } = await import("zod");
  return {
    ...actual,
    extractQuestionsFromPlateContent: vi.fn(() => []),
    responsePayloadItemSchema: z.object({}).passthrough(),
  };
});

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContent: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-analytics", () => ({
  aggregateAllBlocksInBatches: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(() => ({ isValid: true, errors: [] })),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshotByVersion: vi.fn(),
}));

vi.mock("../lib/forms/validation-results", () => ({
  getExternalValidationResults: vi.fn(() => []),
}));

vi.mock("../lib/queues", () => ({
  getValidationQueue: vi.fn(),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

vi.mock("../lib/logger", () => ({
  logWarn: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  asc: vi.fn((field) => ({ op: "asc", field })),
  count: vi.fn(() => "count"),
  countDistinct: vi.fn(() => "countDistinct"),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
  lt: vi.fn((left, right) => ({ op: "lt", left, right })),
  ne: vi.fn((left, right) => ({ op: "ne", left, right })),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
  sql: vi.fn((strings) => String(strings[0] ?? "sql")),
}));

function limitedQuery(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn(function offset(this: unknown, value: number) {
      mocks.offsetCalls.push(value);
      return this;
    }),
    limit: vi.fn((value: number) => {
      mocks.limitCalls.push(value);
      return Promise.resolve(result);
    }),
  };
}

function countQuery(total: number) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: total }]),
  };
}

describe("R3-H5 paginates formerly unbounded list endpoints", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.offsetCalls.length = 0;
    mocks.limitCalls.length = 0;
    mocks.formAuthRoles.length = 0;
  });

  it("requires editor access for response data routes", async () => {
    await import("../routes/forms-responses");
    await import("../routes/forms-sse");

    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.formAuthRoles).not.toContain("VIEWER");
  });

  it("applies limit and offset to response id lists", async () => {
    mocks.db.select
      .mockReturnValueOnce(limitedQuery([{ id: "response-6" }]))
      .mockReturnValueOnce(countQuery(12));
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/ids?page=2&pageSize=5",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responseIds: ["response-6"],
      pagination: { page: 2, pageSize: 5, total: 12, totalPages: 3 },
    });
    expect(mocks.offsetCalls).toContain(5);
    expect(mocks.limitCalls).toContain(5);
  });

  it("uses a bounded default page when pagination query is omitted", async () => {
    mocks.db.select
      .mockReturnValueOnce(limitedQuery([{ id: "response-1" }]))
      .mockReturnValueOnce(countQuery(101));
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/ids");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responseIds: ["response-1"],
      pagination: { page: 1, pageSize: 20, total: 101, totalPages: 6 },
    });
    expect(mocks.offsetCalls).toContain(0);
    expect(mocks.limitCalls).toContain(20);
  });

  it("applies limit and offset to response analytics timelines", async () => {
    mocks.db.select
      .mockReturnValueOnce(limitedQuery([{ date: "2026-05-18", count: 2 }]))
      .mockReturnValueOnce(countQuery(9));
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/analytics?page=3&pageSize=4",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      timeline: [{ date: "2026-05-18", count: 2 }],
      pagination: { page: 3, pageSize: 4, total: 9, totalPages: 3 },
    });
    expect(mocks.offsetCalls).toContain(8);
    expect(mocks.limitCalls).toContain(4);
  });

  it("applies limit and offset to snapshot lists", async () => {
    mocks.db.select
      .mockReturnValueOnce(limitedQuery([{ id: "snapshot-1", version: 4 }]))
      .mockReturnValueOnce(countQuery(6));
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/snapshots?page=2&pageSize=3",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      snapshots: [{ id: "snapshot-1", version: 4 }],
      pagination: { page: 2, pageSize: 3, total: 6, totalPages: 2 },
    });
    expect(mocks.offsetCalls).toContain(3);
    expect(mocks.limitCalls).toContain(3);
  });

  it("applies limit and offset to form schedule lists", async () => {
    mocks.db.select
      .mockReturnValueOnce(limitedQuery([{ id: "schedule-1" }]))
      .mockReturnValueOnce(countQuery(5));
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/schedule?page=2&pageSize=2",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      schedules: [{ id: "schedule-1" }],
      pagination: { page: 2, pageSize: 2, total: 5, totalPages: 3 },
    });
    expect(mocks.offsetCalls).toContain(2);
    expect(mocks.limitCalls).toContain(2);
  });

  it("passes pagination to validation rule listing", async () => {
    mocks.listValidationRules.mockResolvedValue([{ id: "rule-1" }]);
    mocks.countValidationRules.mockResolvedValue(11);
    const { formsValidationRulesRouter } = await import(
      "../routes/forms-validation-rules"
    );

    const res = await formsValidationRulesRouter.request(
      "/form-1/validation-rules?page=3&pageSize=4",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      rules: [{ id: "rule-1" }],
      pagination: { page: 3, pageSize: 4, total: 11, totalPages: 3 },
    });
    expect(mocks.listValidationRules).toHaveBeenCalledWith("form-1", {
      limit: 4,
      offset: 8,
    });
  });
});
