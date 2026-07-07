import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  schema: {
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
    formStructure: {
      formId: "formStructure.formId",
      isActive: "formStructure.isActive",
      structureJson: "formStructure.structureJson",
      version: "formStructure.version",
    },
    externalServiceValidationResult: {
      responseId: "externalServiceValidationResult.responseId",
      ruleId: "externalServiceValidationResult.ruleId",
      metadata: "externalServiceValidationResult.metadata",
      service: "externalServiceValidationResult.service",
      status: "externalServiceValidationResult.status",
      updatedAt: "externalServiceValidationResult.updatedAt",
      createdAt: "externalServiceValidationResult.createdAt",
    },
    formValidationRule: {
      id: "formValidationRule.id",
      name: "formValidationRule.name",
      providerName: "formValidationRule.providerName",
      ruleType: "formValidationRule.ruleType",
    },
  },
  whereConditions: [] as Array<unknown>,
}));

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
  withDualFormAuth:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
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
  getExternalValidationResults: vi.fn(() => []),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/queues", () => ({
  getValidationQueue: vi.fn(),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
}));

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

function query(result: unknown[]) {
  const promise = Promise.resolve(result);
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push(condition);
      return builder;
    }),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable, and this mock must support direct await.
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return builder;
}

describe("response export route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.whereConditions.length = 0;
    delete process.env.SESSION_ALIAS_SALT;
  });

  it("exports only non-deleted response rows that still exist in FormResponse", async () => {
    const submittedAt = new Date("2026-07-06T01:00:00.000Z");
    mocks.db.select
      .mockReturnValueOnce(query([{ plateContent: "[]" }]))
      .mockReturnValueOnce(
        query([
          {
            id: "response-kept",
            formId: "form-1",
            responseDataJson: "[]",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-1",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
          },
        ]),
      )
      .mockReturnValueOnce(query([]))
      .mockReturnValueOnce(
        query([
          {
            structureJson:
              '{"version":1,"settings":{"allow_edit_responses":false}}',
          },
        ]),
      )
      .mockReturnValueOnce(query([]));
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/export");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain("response-kept");
    expect(mocks.whereConditions).toContainEqual({
      op: "eq",
      left: "formResponse.formId",
      right: "form-1",
    });
    expect(mocks.whereConditions).toContainEqual({
      op: "inArray",
      left: "fingerprintDetail.responseId",
      values: ["response-kept"],
    });
  });

  it("exports selected arbitrary validation output values as CSV columns", async () => {
    const submittedAt = new Date("2026-07-06T01:00:00.000Z");
    const structureJson = JSON.stringify({
      version: 1,
      settings: {
        validation_output_export: {
          values: [
            {
              rule_id: "rule-gh",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "followers",
              enabled: false,
            },
          ],
        },
      },
    });
    mocks.db.select
      .mockReturnValueOnce(query([{ plateContent: "[]" }]))
      .mockReturnValueOnce(
        query([
          {
            id: "response-1",
            formId: "form-1",
            responseDataJson: "[]",
            submittedAt,
            updatedAt: null,
            respondentUuid: "respondent-1",
            userAgent: null,
            sessionId: null,
            countryCode: "JP",
          },
        ]),
      )
      .mockReturnValueOnce(query([]))
      .mockReturnValueOnce(query([{ structureJson }]))
      .mockReturnValueOnce(
        query([
          {
            responseId: "response-1",
            ruleId: "rule-gh",
            metadata: {
              validationOutputs: [
                {
                  key: "username",
                  label: "GitHub username",
                  value: "octocat",
                },
                { key: "followers", label: "Followers", value: 42 },
                { key: "profile_score", label: "Profile score", value: 98.5 },
              ],
            },
            service: "github",
            ruleName: "GitHub rule",
            providerName: "github",
            ruleType: "user_exists",
          },
        ]),
      );
    const { formsResponsesRouter } = await import("../routes/forms-responses");

    const res = await formsResponsesRouter.request("/form-1/responses/export");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain(
      '"Validation: GitHub rule (rule-gh) / GitHub username [username]"',
    );
    expect(csv).toContain(
      '"Validation: GitHub rule (rule-gh) / Profile score [profile_score]"',
    );
    expect(csv).toContain('"octocat"');
    expect(csv).toContain('"98.5"');
    expect(csv).not.toContain("Followers");
    expect(csv).not.toContain('"42"');
  });
});
