import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      responseId: "externalServiceValidationResult.responseId",
      tableName: "externalServiceValidationResult",
    },
    fingerprintDetail: {
      responseId: "fingerprintDetail.responseId",
      tableName: "fingerprintDetail",
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
      tableName: "formResponse",
    },
    formValidationRule: {},
  };

  return {
    authAllowed: true,
    db: {
      select: vi.fn(),
      transaction: vi.fn(),
    },
    deleteTables: [] as string[],
    externalValidationResults: [] as Array<Record<string, unknown>>,
    formAuthRoles: [] as Array<unknown>,
    schema,
    tx: {
      delete: vi.fn(),
    },
    whereConditions: [] as Array<unknown>,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {},
}));

vi.mock("@nexus-form/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus-form/shared")>();
  const { z } = await import("zod");
  return {
    ...actual,
    responsePayloadItemSchema: z.object({}).passthrough(),
  };
});

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: (requiredRole?: unknown) => {
    mocks.formAuthRoles.push(requiredRole);
    return async (_c: unknown, next: () => Promise<void>) => {
      if (!mocks.authAllowed) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      await next();
    };
  },
}));

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContent: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(() => ({ isValid: true, errors: [] })),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshotByVersion: vi.fn(),
  getSnapshotByVersion: vi.fn(),
}));

vi.mock("../lib/forms/validation-results", () => ({
  getExternalValidationResults: vi.fn(() => mocks.externalValidationResults),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
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
  return { createRateLimit: () => passThrough };
});

vi.mock("../lib/request-body-size-limit", () => ({
  createRequestBodySizeLimit:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
}));

vi.mock("../lib/response-data-json", () => ({
  stringifyResponseDataJson: vi.fn(() => "[]"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
  ne: vi.fn((left, right) => ({ op: "ne", left, right })),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
  sql: vi.fn((strings) => ({
    as: vi.fn((alias: string) => ({ alias, strings })),
    toString: () => String(strings[0] ?? "sql"),
  })),
}));

function selectLimitQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push(condition);
      return query;
    }),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

function selectWhereQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push(condition);
      return Promise.resolve(result);
    }),
  };
  return query;
}

function deleteQuery(tableName: string) {
  return {
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push({ tableName, condition });
      return Promise.resolve([{ affectedRows: 1 }]);
    }),
  };
}

function tableName(table: unknown): string {
  if (typeof table !== "object" || table === null) return "unknown";
  const value = Reflect.get(table, "tableName");
  return typeof value === "string" ? value : "unknown";
}

async function importRouter() {
  const { formsResponsesRouter } = await import("../routes/forms-responses");
  return formsResponsesRouter;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.authAllowed = true;
  mocks.deleteTables.length = 0;
  mocks.externalValidationResults.length = 0;
  mocks.formAuthRoles.length = 0;
  mocks.whereConditions.length = 0;
  mocks.db.select.mockReset();
  mocks.db.transaction.mockImplementation(async (callback) =>
    callback(mocks.tx),
  );
  mocks.tx.delete.mockImplementation((table: unknown) => {
    const name = tableName(table);
    mocks.deleteTables.push(name);
    return deleteQuery(name);
  });
});

describe("response deletion API", () => {
  it("requires editor authorization before deleting a response", async () => {
    mocks.authAllowed = false;
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("hard-deletes a response and its dependent hidden state", async () => {
    mocks.db.select.mockReturnValueOnce(
      selectLimitQuery([{ id: "response-1" }]),
    );
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteTables).toEqual([
      "fingerprintDetail",
      "externalServiceValidationResult",
      "formResponse",
    ]);
    expect(mocks.whereConditions).toContainEqual({
      tableName: "fingerprintDetail",
      condition: {
        op: "eq",
        left: "fingerprintDetail.responseId",
        right: "response-1",
      },
    });
    expect(mocks.whereConditions).toContainEqual({
      tableName: "externalServiceValidationResult",
      condition: {
        op: "eq",
        left: "externalServiceValidationResult.responseId",
        right: "response-1",
      },
    });
    expect(mocks.whereConditions).toContainEqual({
      tableName: "formResponse",
      condition: { op: "eq", left: "formResponse.id", right: "response-1" },
    });
  });

  it("returns non-leaky not found for unknown or cross-form responses", async () => {
    mocks.db.select.mockReturnValueOnce(selectLimitQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-2/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Response not found" });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.whereConditions).toContainEqual({
      op: "and",
      conditions: [
        { op: "eq", left: "formResponse.id", right: "response-1" },
        { op: "eq", left: "formResponse.formId", right: "form-2" },
      ],
    });
  });

  it("treats repeated deletes as not found after the hard delete commits", async () => {
    mocks.db.select
      .mockReturnValueOnce(selectLimitQuery([{ id: "response-1" }]))
      .mockReturnValueOnce(selectLimitQuery([]));
    const router = await importRouter();

    const first = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });
    const second = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("hides a deleted response from detail reads once the row is gone", async () => {
    mocks.db.select.mockReturnValueOnce(selectLimitQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Response not found" });
  });

  it("preserves validation output values through the response detail schema boundary", async () => {
    mocks.externalValidationResults.push({
      id: "validation-result-1",
      response_id: "response-1",
      rule_id: "rule-1",
      rule_name: "GitHub user",
      provider_name: "github",
      rule_type: "user_exists",
      referenced_block_id: "block-1",
      referenced_block_label: "GitHub username",
      referenced_block_missing: false,
      service: "github",
      status: "COMPLETED",
      success: true,
      attempt_count: 1,
      metadata: {
        validationOutputs: [
          { key: "username", label: "Username", value: "octocat" },
        ],
      },
      output_values: [
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: "42" },
      ],
      error_code: null,
      error_message: null,
      job_id: null,
      created_at: "2026-07-06T00:00:00.000Z",
      updated_at: "2026-07-06T00:00:01.000Z",
    });
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            response: {
              id: "response-1",
              formId: "form-1",
              responseDataJson: "[]",
              submittedAt: new Date("2026-07-06T00:00:00.000Z"),
              updatedAt: null,
              respondentUuid: "respondent-1",
              userAgent: null,
              sessionId: null,
              countryCode: null,
            },
            plateContent: "[]",
          },
        ]),
      )
      .mockReturnValueOnce(selectLimitQuery([{ id: "response-1" }]))
      .mockReturnValueOnce(selectWhereQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.externalValidations[0].output_values).toEqual([
      { key: "username", label: "Username", value: "octocat" },
      { key: "followers", value: "42" },
    ]);
  });
});
