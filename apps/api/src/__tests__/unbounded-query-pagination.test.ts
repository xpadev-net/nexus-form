import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
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
    updatedAt: "formResponse.updatedAt",
    respondentUuid: "formResponse.respondentUuid",
    userAgent: "formResponse.userAgent",
    sessionId: "formResponse.sessionId",
    countryCode: "formResponse.countryCode",
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

vi.mock("../lib/rate-limit", () => {
  const passThrough = async (
    _c: unknown,
    next: () => Promise<void>,
  ): Promise<void> => next();
  return {
    createRateLimit: () => passThrough,
    authRouteRateLimiter: passThrough,
    generalRateLimiter: passThrough,
    invitationSignInRateLimiter: passThrough,
  };
});

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
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

interface ValidationTargetQuery {
  from: Mock<() => ValidationTargetQuery>;
  innerJoin: Mock<() => ValidationTargetQuery>;
  where: Mock<() => ValidationTargetQuery>;
  limit: Mock<() => Promise<unknown[]>>;
}

interface UpdateQuery {
  set: Mock<() => UpdateQuery>;
  where: Mock<() => Promise<Array<{ affectedRows: number }>>>;
}

function validationTargetQuery(result: unknown[]): ValidationTargetQuery {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

function updateQuery(affectedRows = 1): UpdateQuery {
  const query = {
    set: vi.fn(() => query),
    where: vi.fn(() => Promise.resolve([{ affectedRows }])),
  };
  return query;
}

describe("R3-H5 paginates formerly unbounded list endpoints", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.db.update.mockReset();
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
    mocks.db.select.mockReturnValueOnce(
      limitedQuery([
        { id: "response-6" },
        { id: "response-7" },
        { id: "response-8" },
        { id: "response-9" },
        { id: "response-10" },
        { id: "response-11" },
      ]),
    );
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/ids?page=2&pageSize=5",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responseIds: [
        "response-6",
        "response-7",
        "response-8",
        "response-9",
        "response-10",
      ],
      pagination: { page: 2, pageSize: 5, hasNext: true },
    });
    expect(mocks.offsetCalls).toContain(5);
    expect(mocks.limitCalls).toContain(6);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded default page when pagination query is omitted", async () => {
    mocks.db.select.mockReturnValueOnce(limitedQuery([{ id: "response-1" }]));
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/ids");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responseIds: ["response-1"],
      pagination: { page: 1, pageSize: 20, hasNext: false },
    });
    expect(mocks.offsetCalls).toContain(0);
    expect(mocks.limitCalls).toContain(21);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it("applies keyword filters before paginating response lists", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select.mockReturnValueOnce(
      limitedQuery([
        {
          id: "response-1",
          formId: "form-1",
          submittedAt,
          updatedAt: null,
          respondentUuid: "respondent-alpha",
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
        },
      ]),
    );
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?page=2&limit=5&keyword=alpha",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responses: [{ id: "response-1", respondentUuid: "respondent-alpha" }],
      page: 2,
      limit: 5,
      hasNext: false,
    });
    expect(vi.mocked(sql).mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.stringMatching(/instr|lower/i)]),
      ]),
    );
    const prefixLikeCalls = vi
      .mocked(sql)
      .mock.calls.filter((call) => String(call[0]).includes(" like "));
    expect(prefixLikeCalls).toEqual([
      [expect.anything(), "formResponse.id", "alpha%", "!"],
      [expect.anything(), "formResponse.respondentUuid", "alpha%", "!"],
      [expect.anything(), "formResponse.countryCode", "ALPHA%", "!"],
    ]);
    expect(mocks.offsetCalls).toContain(5);
    expect(mocks.limitCalls).toContain(6);
  });

  it("returns hasNext and trims the extra row for response lists", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select.mockReturnValueOnce(
      limitedQuery(
        Array.from({ length: 6 }, (_, index) => ({
          id: `response-${index + 1}`,
          formId: "form-1",
          submittedAt,
          updatedAt: null,
          respondentUuid: `respondent-${index + 1}`,
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
        })),
      ),
    );
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?page=2&limit=5",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responses: [
        { id: "response-1" },
        { id: "response-2" },
        { id: "response-3" },
        { id: "response-4" },
        { id: "response-5" },
      ],
      page: 2,
      limit: 5,
      hasNext: true,
    });
    expect(mocks.offsetCalls).toContain(5);
    expect(mocks.limitCalls).toContain(6);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it("escapes wildcard characters in response keyword prefix filters", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select.mockReturnValueOnce(
      limitedQuery([
        {
          id: "response-1",
          formId: "form-1",
          submittedAt,
          updatedAt: null,
          respondentUuid: "respondent-alpha",
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
        },
      ]),
    );
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?keyword=a%5C_%25",
    );

    expect(res.status).toBe(200);
    const prefixLikeCalls = vi
      .mocked(sql)
      .mock.calls.filter((call) => String(call[0]).includes(" like "));
    expect(prefixLikeCalls).toEqual([
      [expect.anything(), "formResponse.id", "a\\!_!%%", "!"],
      [expect.anything(), "formResponse.respondentUuid", "a\\!_!%%", "!"],
      [expect.anything(), "formResponse.countryCode", "A\\!_!%%", "!"],
    ]);
  });

  it("does not use non-sargable keyword filters for response lists", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select.mockReturnValueOnce(
      limitedQuery([
        {
          id: "response-1",
          formId: "form-1",
          submittedAt,
          updatedAt: null,
          respondentUuid: "respondent-alpha",
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
        },
      ]),
    );
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?keyword=alpha",
    );

    expect(res.status).toBe(200);
    const instrCalls = vi
      .mocked(sql)
      .mock.calls.filter((call) => String(call[0][0]).includes("instr("));
    const lowerCalls = vi
      .mocked(sql)
      .mock.calls.filter((call) => String(call[0][0]).includes("lower("));
    expect(instrCalls).toHaveLength(0);
    expect(lowerCalls).toHaveLength(0);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it("applies limit and offset to response analytics timelines", async () => {
    mocks.db.select.mockReturnValueOnce(
      limitedQuery([
        { date: "2026-05-18", count: 2 },
        { date: "2026-05-17", count: 3 },
        { date: "2026-05-16", count: 1 },
        { date: "2026-05-15", count: 4 },
        { date: "2026-05-14", count: 5 },
      ]),
    );
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/analytics?page=3&pageSize=4",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      timeline: [
        { date: "2026-05-18", count: 2 },
        { date: "2026-05-17", count: 3 },
        { date: "2026-05-16", count: 1 },
        { date: "2026-05-15", count: 4 },
      ],
      pagination: { page: 3, pageSize: 4, hasNext: true },
    });
    expect(mocks.offsetCalls).toContain(8);
    expect(mocks.limitCalls).toContain(5);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it("applies limit and offset to snapshot lists", async () => {
    const publishedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(
        limitedQuery([
          {
            id: "snapshot-1",
            formId: "form-1",
            version: 4,
            isActive: true,
            publishedBy: "user-1",
            publishedAt,
            changeLog: null,
            title: "Snapshot 1",
            description: null,
            parentVersion: null,
          },
        ]),
      )
      .mockReturnValueOnce(countQuery(6));
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const res = await formsSnapshotsRouter.request(
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
    const now = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(
        limitedQuery([
          {
            id: "schedule-1",
            formId: "form-1",
            triggerAt: now,
            action: "PUBLISH",
            snapshotVersion: null,
            processedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      )
      .mockReturnValueOnce(countQuery(5));
    const { formsScheduleRouter } = await import("../routes/forms-schedule");

    const res = await formsScheduleRouter.request(
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

  it("discards and removes waiting validation jobs during cancellation", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const getState = vi.fn().mockResolvedValue("waiting");
    const getJob = vi.fn().mockResolvedValue({ discard, getState, remove });
    const { getValidationQueue } = await import("../lib/queues");
    vi.mocked(getValidationQueue).mockReturnValue({ getJob } as never);
    mocks.db.select.mockReturnValueOnce(
      validationTargetQuery([
        {
          id: "validation-1",
          service: "discord",
          jobId: "job-1",
          status: "PENDING",
        },
      ]),
    );
    mocks.db.update.mockReturnValueOnce(updateQuery());
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/response-1/validation/validation-1/cancel",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(getValidationQueue).toHaveBeenCalledWith("discord");
    expect(getJob).toHaveBeenCalledWith("job-1");
    expect(discard).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it("does not remove active validation jobs during cancellation", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const getState = vi.fn().mockResolvedValue("active");
    const getJob = vi.fn().mockResolvedValue({ discard, getState, remove });
    const { getValidationQueue } = await import("../lib/queues");
    vi.mocked(getValidationQueue).mockReturnValue({ getJob } as never);
    mocks.db.select.mockReturnValueOnce(
      validationTargetQuery([
        {
          id: "validation-1",
          service: "discord",
          jobId: "job-1",
          status: "PROCESSING",
        },
      ]),
    );
    mocks.db.update.mockReturnValueOnce(updateQuery());
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/response-1/validation/validation-1/cancel",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(discard).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it("still marks validation as cancelled when queue discard fails", async () => {
    const getJob = vi.fn().mockRejectedValue(new Error("redis unavailable"));
    const { getValidationQueue } = await import("../lib/queues");
    vi.mocked(getValidationQueue).mockReturnValue({ getJob } as never);
    mocks.db.select.mockReturnValueOnce(
      validationTargetQuery([
        {
          id: "validation-1",
          service: "discord",
          jobId: "job-1",
          status: "FAILED",
        },
      ]),
    );
    mocks.db.update.mockReturnValueOnce(updateQuery());
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/response-1/validation/validation-1/cancel",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it("still marks validation as cancelled when queued job removal races with activation", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockRejectedValue(new Error("job active"));
    const getState = vi.fn().mockResolvedValue("waiting");
    const getJob = vi.fn().mockResolvedValue({ discard, getState, remove });
    const { getValidationQueue } = await import("../lib/queues");
    vi.mocked(getValidationQueue).mockReturnValue({ getJob } as never);
    mocks.db.select.mockReturnValueOnce(
      validationTargetQuery([
        {
          id: "validation-1",
          service: "discord",
          jobId: "job-1",
          status: "PENDING",
        },
      ]),
    );
    mocks.db.update.mockReturnValueOnce(updateQuery());
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/response-1/validation/validation-1/cancel",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it("rejects cancellation when validation already completed", async () => {
    const getJob = vi.fn();
    const { getValidationQueue } = await import("../lib/queues");
    vi.mocked(getValidationQueue).mockReturnValue({ getJob } as never);
    mocks.db.select.mockReturnValueOnce(
      validationTargetQuery([
        {
          id: "validation-1",
          service: "discord",
          jobId: "job-1",
          status: "COMPLETED",
        },
      ]),
    );
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/response-1/validation/validation-1/cancel",
      { method: "POST" },
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Validation result cannot be cancelled in its current status",
    });
    expect(getValidationQueue).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("does not overwrite a validation result completed during cancellation", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const getState = vi.fn().mockResolvedValue("waiting");
    const getJob = vi.fn().mockResolvedValue({ discard, getState, remove });
    const { getValidationQueue } = await import("../lib/queues");
    vi.mocked(getValidationQueue).mockReturnValue({ getJob } as never);
    mocks.db.select
      .mockReturnValueOnce(
        validationTargetQuery([
          {
            id: "validation-1",
            service: "discord",
            jobId: "job-1",
            status: "PROCESSING",
          },
        ]),
      )
      .mockReturnValueOnce(
        validationTargetQuery([{ id: "validation-1", status: "COMPLETED" }]),
      );
    mocks.db.update.mockReturnValueOnce(updateQuery(0));
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses/response-1/validation/validation-1/cancel",
      { method: "POST" },
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Validation result cannot be cancelled in its current status",
    });
    expect(discard).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it("passes pagination to validation rule listing", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    mocks.listValidationRules.mockResolvedValue([
      {
        id: "rule-1",
        formId: "form-1",
        name: "Rule 1",
        providerName: "builtin_discord",
        ruleType: "guild_member",
        referencedBlockIds: [],
        configJson: {},
        orderIndex: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);
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
