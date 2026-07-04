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
  getValidationRule: vi.fn(),
  ValidationRuleConfigError: class ValidationRuleConfigError extends Error {},
  publishSnapshot: vi.fn(),
  calculateFormDiff: vi.fn(),
  checkUnpublishedChanges: vi.fn(),
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
  fingerprintDetail: {
    responseId: "fingerprintDetail.responseId",
    componentName: "fingerprintDetail.componentName",
    componentValueHash: "fingerprintDetail.componentValueHash",
    fingerprintType: "fingerprintDetail.fingerprintType",
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
    return async (
      c: { set?: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set?.("dualAuthContext", { user_id: "user-1" });
      await next();
    };
  },
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  listValidationRules: mocks.listValidationRules,
  countValidationRules: mocks.countValidationRules,
  createValidationRule: vi.fn(),
  deleteValidationRule: vi.fn(),
  getValidationRule: mocks.getValidationRule,
  reorderValidationRules: vi.fn(),
  updateValidationRule: vi.fn(),
  ValidationRuleConfigError: mocks.ValidationRuleConfigError,
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
  activateSnapshot: vi.fn(),
  calculateFormDiff: mocks.calculateFormDiff,
  checkUnpublishedChanges: mocks.checkUnpublishedChanges,
  getLatestSnapshotByVersion: vi.fn(),
  getLatestSnapshot: vi.fn(),
  publishSnapshot: mocks.publishSnapshot,
  restoreFromSnapshot: vi.fn(),
  restoreFromSnapshotVersion: vi.fn(),
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
  sql: vi.fn((strings) => {
    const expression = {
      as: vi.fn((alias: string) => ({ alias, expression })),
      toString: () => String(strings[0] ?? "sql"),
    };
    return expression;
  }),
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

function failingLimitedQuery(error: unknown) {
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
      return Promise.reject(error);
    }),
  };
}

function orderedQuery(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn((value: number) => {
      mocks.limitCalls.push(value);
      return Promise.resolve(result);
    }),
  };
}

function whereQuery(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(() => Promise.resolve(result)),
  };
}

function emptySelectQuery(result: unknown[]) {
  const promise = Promise.resolve(result);
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    groupBy: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    offset: vi.fn((value: number) => {
      mocks.offsetCalls.push(value);
      return query;
    }),
    limit: vi.fn((value: number) => {
      mocks.limitCalls.push(value);
      return Promise.resolve(result);
    }),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable, and this mock must support direct await.
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return query;
}

function countQuery(total: number) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: total }]),
  };
}

function findOrderBySqlTemplateStrings(
  calls: Array<unknown[]>,
  sortField: string,
): string[] | undefined {
  const orderByCall = calls.find(
    (call) => call[1] === sortField && call[2] === "formResponse.id",
  );
  const templateStrings = orderByCall?.[0];
  if (!Array.isArray(templateStrings)) return undefined;
  return [...templateStrings];
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
    mocks.db.select.mockImplementation(() => emptySelectQuery([]));
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

  it("aliases keyword to response body search before paginating response lists", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(orderedQuery([{ plateContent: "[]" }]))
      .mockReturnValueOnce(
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
            responseDataJson: JSON.stringify([
              {
                question_id: "short-question",
                question_type: "short_text",
                value: `alpha answer ${index + 1}`,
              },
            ]),
          })),
        ),
      );
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?page=2&limit=5&keyword=alpha",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responses: [{ id: "response-6", respondentUuid: "respondent-6" }],
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
      [expect.anything(), "formResponse.responseDataJson", "%alpha%", "!"],
      [expect.anything(), "formResponse.responseDataJson", "%ALPHA%", "!"],
    ]);
    expect(mocks.offsetCalls).toContain(0);
    expect(mocks.limitCalls).toContain(200);
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
    const body = (await res.json()) as {
      responses: Array<{ id: string; responseDataJson?: unknown }>;
      page: number;
      limit: number;
      hasNext: boolean;
    };
    expect(body).toMatchObject({
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
    expect(body.responses[0]).not.toHaveProperty("responseDataJson");
    expect(mocks.offsetCalls).toContain(5);
    expect(mocks.limitCalls).toContain(6);
    expect(mocks.limitCalls).toContain(5001);
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
  });

  it("returns null uniqueness scores when the bounded calculation scope is exceeded", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(
        limitedQuery([
          {
            id: "response-1",
            formId: "form-1",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-1",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
          },
        ]),
      )
      .mockReturnValueOnce(
        orderedQuery(
          Array.from({ length: 5001 }, (_, index) => ({
            id: `response-${index}`,
          })),
        ),
      );
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responses: [{ id: "response-1", uniquenessScore: null }],
    });
    expect(mocks.limitCalls).toContain(5001);
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
  });

  it("escapes wildcard characters in response search filters", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(orderedQuery([{ plateContent: "[]" }]))
      .mockReturnValueOnce(
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
            responseDataJson: "[]",
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
      [expect.anything(), "formResponse.responseDataJson", "%a\\!_!%%", "!"],
      [expect.anything(), "formResponse.responseDataJson", "%A\\!_!%%", "!"],
    ]);
  });

  it("does not search response bodies when the search query is omitted", async () => {
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

    const res = await formsResponsesRouter.request("/form-1/responses");

    expect(res.status).toBe(200);
    const { sql } = await import("drizzle-orm");
    const responseBodySearchCalls = vi
      .mocked(sql)
      .mock.calls.filter((call) => call[1] === "formResponse.responseDataJson");
    expect(responseBodySearchCalls).toHaveLength(0);
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
  });

  it("searches response body text and choice display labels with q before paginating", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const { buildQuestionsFromPlateContent } = await import(
      "../lib/forms/plate-question-builder"
    );
    vi.mocked(buildQuestionsFromPlateContent).mockReturnValueOnce([
      {
        id: "radio-question",
        type: "radio",
        validation: {
          options: [{ id: "radio-option", label: "Needle Radio" }],
        },
      },
      {
        id: "checkbox-question",
        type: "checkbox",
        validation: {
          options: [{ id: "checkbox-option", label: "Needle Checkbox" }],
        },
      },
    ] satisfies ReturnType<typeof buildQuestionsFromPlateContent>);
    mocks.db.select
      .mockReturnValueOnce(orderedQuery([{ plateContent: "[]" }]))
      .mockReturnValueOnce(
        limitedQuery([
          {
            id: "response-short",
            formId: "form-1",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-short",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
            responseDataJson: JSON.stringify([
              {
                question_id: "short-question",
                question_type: "short_text",
                value: "Needle short answer",
              },
            ]),
          },
          {
            id: "response-long",
            formId: "form-1",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-long",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
            responseDataJson: JSON.stringify([
              {
                question_id: "long-question",
                question_type: "long_text",
                value: "Long answer with Needle",
              },
            ]),
          },
          {
            id: "response-radio",
            formId: "form-1",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-radio",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
            responseDataJson: JSON.stringify([
              {
                question_id: "radio-question",
                question_type: "radio",
                value: "radio-option",
              },
            ]),
          },
          {
            id: "response-checkbox",
            formId: "form-1",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-checkbox",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
            responseDataJson: JSON.stringify([
              {
                question_id: "checkbox-question",
                question_type: "checkbox",
                values: ["checkbox-option"],
              },
            ]),
          },
        ]),
      );
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?page=1&limit=3&q=Needle",
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      responses: Array<{ id: string; responseDataJson?: unknown }>;
      hasNext: boolean;
    };
    expect(body.responses.map((response) => response.id)).toEqual([
      "response-short",
      "response-long",
      "response-radio",
    ]);
    expect(body.hasNext).toBe(true);
    expect(body.responses[0]).not.toHaveProperty("responseDataJson");

    const responseJsonLikeCalls = vi
      .mocked(sql)
      .mock.calls.filter((call) => call[1] === "formResponse.responseDataJson");
    expect(responseJsonLikeCalls).toEqual([
      [expect.anything(), "formResponse.responseDataJson", "%Needle%", "!"],
      [expect.anything(), "formResponse.responseDataJson", "%needle%", "!"],
      [expect.anything(), "formResponse.responseDataJson", "%NEEDLE%", "!"],
      [
        expect.anything(),
        "formResponse.responseDataJson",
        '%"radio-option"%',
        "!",
      ],
      [
        expect.anything(),
        "formResponse.responseDataJson",
        '%"checkbox-option"%',
        "!",
      ],
    ]);
    expect(vi.mocked(sql).mock.calls).toEqual(
      expect.arrayContaining([
        [expect.anything(), "formResponse.submittedAt", "formResponse.id"],
      ]),
    );
  });

  it("uses a stable response id tiebreaker for search sort order", async () => {
    mocks.db.select
      .mockReturnValueOnce(orderedQuery([{ plateContent: "[]" }]))
      .mockReturnValueOnce(limitedQuery([]));
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?q=alpha&sort=updatedAt&order=asc",
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(sql).mock.calls).toEqual(
      expect.arrayContaining([
        [expect.anything(), "formResponse.updatedAt", "formResponse.id"],
      ]),
    );
  });

  it("keeps descending response list sorts aligned with the id tiebreaker", async () => {
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const submittedAtRes = await formsResponsesRouter.request(
      "/form-1/responses?order=desc",
    );
    const updatedAtRes = await formsResponsesRouter.request(
      "/form-1/responses?sort=updatedAt&order=desc",
    );

    expect(submittedAtRes.status).toBe(200);
    expect(updatedAtRes.status).toBe(200);
    const sqlCalls = vi.mocked(sql).mock.calls;
    expect(
      findOrderBySqlTemplateStrings(sqlCalls, "formResponse.submittedAt"),
    ).toEqual(["", " desc, ", " desc"]);
    expect(
      findOrderBySqlTemplateStrings(sqlCalls, "formResponse.updatedAt"),
    ).toEqual(["", " desc, ", " desc"]);
  });

  it("keeps descending response search sorts aligned with the id tiebreaker", async () => {
    mocks.db.select
      .mockReturnValueOnce(orderedQuery([{ plateContent: "[]" }]))
      .mockReturnValueOnce(limitedQuery([]));
    const { formsResponsesRouter } = await import("../routes/forms-responses");
    const { sql } = await import("drizzle-orm");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?q=alpha&order=desc",
    );

    expect(res.status).toBe(200);
    expect(
      findOrderBySqlTemplateStrings(
        vi.mocked(sql).mock.calls,
        "formResponse.submittedAt",
      ),
    ).toEqual(["", " desc, ", " desc"]);
  });

  it("bounds candidate scans for sparse response body searches", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const falsePositiveRows = Array.from({ length: 200 }, (_, index) => ({
      id: `response-${index + 1}`,
      formId: "form-1",
      submittedAt,
      updatedAt: null,
      respondentUuid: `respondent-${index + 1}`,
      userAgent: null,
      sessionId: null,
      countryCode: "JP",
      responseDataJson: "[]",
    }));
    mocks.db.select.mockReturnValueOnce(orderedQuery([{ plateContent: "[]" }]));
    for (let batch = 0; batch < 25; batch += 1) {
      mocks.db.select.mockReturnValueOnce(limitedQuery(falsePositiveRows));
    }
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request(
      "/form-1/responses?page=1&limit=20&q=sparse",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      responses: [],
      hasNext: false,
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(27);
    expect(mocks.offsetCalls).toEqual(
      Array.from({ length: 25 }, (_, index) => index * 200),
    );
    expect(mocks.limitCalls.filter((limit) => limit === 200)).toHaveLength(25);
  });

  it("exports saved responseDataJson values as CSV", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(
        limitedQuery([
          {
            plateContent: JSON.stringify([
              { type: "form_short_text", blockId: "name-block" },
            ]),
          },
        ]),
      )
      .mockReturnValueOnce(
        orderedQuery([
          {
            id: "response-1",
            formId: "form-1",
            responseDataJson: JSON.stringify([
              {
                question_id: "name-block",
                question_type: "short_text",
                value: "山田 太郎",
              },
            ]),
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-alpha",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
          },
        ]),
      )
      .mockReturnValueOnce(whereQuery([]));
    const { extractQuestionsFromPlateContent } = await import(
      "@nexus-form/shared"
    );
    vi.mocked(extractQuestionsFromPlateContent).mockReturnValueOnce([
      {
        blockId: "name-block",
        type: "short_text",
        title: "氏名",
        validation: {},
      },
    ]);
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/export");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="responses-form-1.csv"',
    );
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain('"氏名"');
    expect(csv.split("\n")[1]).toBe(
      '"response-1","respondent-alpha","2026-01-01T00:00:00.000Z","","JP","","1.0000","山田 太郎"',
    );
    expect(mocks.db.select).toHaveBeenCalledTimes(3);
    expect(mocks.limitCalls).toContain(5001);
  });

  it("returns a header-only CSV when there are no saved responses", async () => {
    mocks.db.select
      .mockReturnValueOnce(
        limitedQuery([
          {
            plateContent: JSON.stringify([
              { type: "form_short_text", blockId: "name-block" },
            ]),
          },
        ]),
      )
      .mockReturnValueOnce(orderedQuery([]));
    const { extractQuestionsFromPlateContent } = await import(
      "@nexus-form/shared"
    );
    vi.mocked(extractQuestionsFromPlateContent).mockReturnValueOnce([
      {
        blockId: "name-block",
        type: "short_text",
        title: "氏名",
        validation: {},
      },
    ]);
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/export");

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","氏名"',
    );
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.limitCalls).toContain(5001);
  });

  it("rejects CSV export before loading fingerprints when response rows exceed the cap", async () => {
    mocks.db.select
      .mockReturnValueOnce(limitedQuery([{ plateContent: "[]" }]))
      .mockReturnValueOnce(
        orderedQuery(
          Array.from({ length: 5001 }, (_, index) => ({
            id: `response-${index}`,
            formId: "form-1",
            responseDataJson: "[]",
            submittedAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: null,
            respondentUuid: `respondent-${index}`,
            userAgent: null,
            sessionId: null,
            countryCode: null,
          })),
        ),
      );
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/export");

    expect(res.status).toBe(413);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.json()).resolves.toMatchObject({
      error: "Response export is limited to 5000 responses",
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.limitCalls).toContain(5001);
  });

  it("applies limit and offset to response analytics timelines", async () => {
    const query = limitedQuery([
      { date: "2026-05-18", count: 2 },
      { date: "2026-05-17", count: 3 },
      { date: "2026-05-16", count: 1 },
      { date: "2026-05-15", count: 4 },
      { date: "2026-05-14", count: 5 },
    ]);
    mocks.db.select.mockReturnValueOnce(query);
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );
    const { sql } = await import("drizzle-orm");

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
    const sqlCalls = vi.mocked(sql).mock.calls;
    expect(sqlCalls).toEqual(
      expect.arrayContaining([
        [["date_format(", ", '%Y-%m-%d')"], "formResponse.submittedAt"],
      ]),
    );
    expect(query.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ alias: "date" }),
    );
    expect(query.orderBy).toHaveBeenCalledWith(
      expect.objectContaining({
        field: expect.objectContaining({ alias: "date" }),
        op: "desc",
      }),
    );
    expect(query.groupBy).toHaveBeenCalledTimes(1);
    expect(query.orderBy).toHaveBeenCalledTimes(1);
  });

  it("returns an empty response analytics timeline as a successful page", async () => {
    mocks.db.select.mockReturnValueOnce(limitedQuery([]));
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/analytics?page=1&pageSize=4",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      timeline: [],
      pagination: { page: 1, pageSize: 4, hasNext: false },
    });
    expect(mocks.offsetCalls).toContain(0);
    expect(mocks.limitCalls).toContain(5);
  });

  it("logs MySQL driver details when response analytics timeline loading fails", async () => {
    const dbError = Object.assign(new Error("Unknown column submittedAt"), {
      code: "ER_BAD_FIELD_ERROR",
      errno: 1054,
      sqlState: "42S22",
      sqlMessage: "Unknown column 'submittedAt' in 'group statement'",
    });
    mocks.db.select.mockReturnValueOnce(failingLimitedQuery(dbError));
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );
    const { logError } = await import("../lib/logger");

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/analytics?page=2&pageSize=10",
    );

    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      "Failed to load response analytics timeline",
      "database",
      expect.objectContaining({
        error: dbError,
        formId: "form-1",
        page: 2,
        pageSize: 10,
        code: "ER_BAD_FIELD_ERROR",
        errno: 1054,
        sqlState: "42S22",
        sqlMessage: "Unknown column 'submittedAt' in 'group statement'",
      }),
    );
  });

  it("returns empty block analytics successfully when the form has no analytics targets", async () => {
    mocks.db.select.mockReturnValueOnce(
      limitedQuery([{ plateContent: JSON.stringify([]) }]),
    );
    const { formsResponseAnalyticsRouter } = await import(
      "../routes/forms-response-analytics"
    );

    const res = await formsResponseAnalyticsRouter.request(
      "/form-1/responses/block-analytics",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ blocks: [] });
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

  it("maps invalid stored validation rule configs to 400 on listing", async () => {
    mocks.listValidationRules.mockRejectedValue(
      new mocks.ValidationRuleConfigError(
        "Invalid discord.guild_member config",
      ),
    );
    mocks.countValidationRules.mockResolvedValue(1);
    const { formsValidationRulesRouter } = await import(
      "../routes/forms-validation-rules"
    );

    const res = await formsValidationRulesRouter.request(
      "/form-1/validation-rules",
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid discord.guild_member config",
    });
  });

  it("maps invalid stored validation rule configs to 400 on single rule reads", async () => {
    mocks.getValidationRule.mockRejectedValue(
      new mocks.ValidationRuleConfigError(
        "Invalid discord.guild_member config",
      ),
    );
    const { formsValidationRulesRouter } = await import(
      "../routes/forms-validation-rules"
    );

    const res = await formsValidationRulesRouter.request(
      "/form-1/validation-rules/rule-1",
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid discord.guild_member config",
    });
  });

  it("maps invalid stored validation rule configs to 400 when publishing snapshots", async () => {
    mocks.publishSnapshot.mockRejectedValue(
      new mocks.ValidationRuleConfigError(
        "Invalid discord.guild_member config",
      ),
    );
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const res = await formsSnapshotsRouter.request("/form-1/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid discord.guild_member config",
    });
  });

  it("maps invalid stored validation rule configs to 400 when calculating diffs", async () => {
    mocks.calculateFormDiff.mockRejectedValue(
      new mocks.ValidationRuleConfigError(
        "Invalid discord.guild_member config",
      ),
    );
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const res = await formsSnapshotsRouter.request("/form-1/diff");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid discord.guild_member config",
    });
  });

  it("maps invalid stored validation rule configs to 400 when checking unpublished changes", async () => {
    mocks.checkUnpublishedChanges.mockRejectedValue(
      new mocks.ValidationRuleConfigError(
        "Invalid discord.guild_member config",
      ),
    );
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const res = await formsSnapshotsRouter.request(
      "/form-1/unpublished-changes",
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid discord.guild_member config",
    });
  });
});
