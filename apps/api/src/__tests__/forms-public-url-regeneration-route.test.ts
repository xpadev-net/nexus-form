import { beforeEach, describe, expect, it, vi } from "vitest";

type EqCondition = {
  type: "eq";
  left: unknown;
  right: unknown;
};

type StoredResponse = {
  countryCode: string | null;
  formId: string;
  id: string;
  responseDataJson: string;
  respondentUuid: string;
  sessionId: string | null;
  submittedAt: Date;
  updatedAt: Date | null;
  userAgent: string | null;
};

const mocks = vi.hoisted(() => {
  const schema = {
    apiToken: {
      shareLinkId: "apiToken.shareLinkId",
    },
    externalServiceValidationResult: {
      id: "externalServiceValidationResult.id",
      jobId: "externalServiceValidationResult.jobId",
    },
    fingerprintDetail: {
      responseId: "fingerprintDetail.responseId",
    },
    form: {
      allowEditResponses: "form.allowEditResponses",
      baseSnapshotVersion: "form.baseSnapshotVersion",
      createdAt: "form.createdAt",
      creatorId: "form.creatorId",
      description: "form.description",
      id: "form.id",
      plateContent: "form.plateContent",
      plateContentVersion: "form.plateContentVersion",
      publicId: "form.publicId",
      publishedAt: "form.publishedAt",
      status: "form.status",
      title: "form.title",
      unpublishedAt: "form.unpublishedAt",
      updatedAt: "form.updatedAt",
      version: "form.version",
    },
    formIntegration: {
      formId: "formIntegration.formId",
    },
    formInvitation: {
      formId: "formInvitation.formId",
    },
    formPermission: {
      formId: "formPermission.formId",
    },
    formResponse: {
      formId: "formResponse.formId",
      id: "formResponse.id",
    },
    formSchedule: {
      formId: "formSchedule.formId",
      id: "formSchedule.id",
      processedAt: "formSchedule.processedAt",
      triggerAt: "formSchedule.triggerAt",
    },
    formShareLink: {
      formId: "formShareLink.formId",
      id: "formShareLink.id",
    },
    formSnapshot: {
      formId: "formSnapshot.formId",
    },
    formStructure: {
      formId: "formStructure.formId",
      isActive: "formStructure.isActive",
      version: "formStructure.version",
    },
    formValidationRule: {
      formId: "formValidationRule.formId",
      id: "formValidationRule.id",
    },
    formValidationRuleBlock: {
      ruleId: "formValidationRuleBlock.ruleId",
    },
    user: {
      id: "user.id",
    },
  };

  return {
    addSheetsSyncJob: vi.fn(),
    addValidationJob: vi.fn(),
    consumeTokensOrThrow: vi.fn(),
    db: {
      select: vi.fn(),
      transaction: vi.fn(),
      update: vi.fn(),
    },
    getLatestSnapshot: vi.fn(),
    processFormSchedule: vi.fn(),
    randomUUID: vi.fn(),
    resolveSessionIdOrCreate: vi.fn(),
    schema,
    verifyHCaptcha: vi.fn(),
  };
});

const formState = {
  publicId: "old-public-id",
};
const responses: StoredResponse[] = [];

vi.mock("node:crypto", () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  form: mocks.schema.form,
  user: mocks.schema.user,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "owner-1",
      });
      await next();
    };
  },
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: vi.fn(),
}));

vi.mock("../lib/forms/schedule-error-logging", () => ({
  logFormScheduleError: vi.fn(),
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: mocks.processFormSchedule,
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: mocks.getLatestSnapshot,
}));

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(() => []),
}));

vi.mock("../lib/forms/permission-service", () => ({
  validateShareLink: vi.fn(),
}));

vi.mock("../lib/security/hcaptcha", () => ({
  verifyHCaptcha: mocks.verifyHCaptcha,
}));

vi.mock("../lib/security/form-security-bypass", () => ({
  isFormSecurityBypassEnabled: vi.fn(() => true),
}));

vi.mock("../lib/security/password", () => ({
  verifyPassword: vi.fn(),
}));

vi.mock("../lib/sessions/jwt", () => ({
  extractJwtFromRequest: vi.fn(() => null),
  resolveSessionIdOrCreate: mocks.resolveSessionIdOrCreate,
  signSessionJwt: vi.fn(() => "session-jwt"),
  verifySessionJwt: vi.fn(() => null),
}));

vi.mock("../lib/telemetry/tokens", () => ({
  consumeTokensOrThrow: mocks.consumeTokensOrThrow,
}));

vi.mock("../lib/queues", () => ({
  getSheetsSyncQueue: vi.fn(() => ({ add: mocks.addSheetsSyncJob })),
  getValidationQueue: vi.fn(() => ({ add: mocks.addValidationJob })),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/ip-address", () => ({
  extractClientIP: vi.fn(() => ({ ip: "127.0.0.1" })),
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  count: vi.fn(() => ({ type: "count" })),
  desc: vi.fn((value: unknown) => ({ type: "desc", value })),
  eq: vi.fn(
    (left: unknown, right: unknown): EqCondition => ({
      type: "eq",
      left,
      right,
    }),
  ),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({
    type: "inArray",
    left,
    values,
  })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
}));

function publishedSnapshot() {
  const plateContent = JSON.stringify([
    {
      type: "form_short_text",
      blockId: "question-1",
      children: [{ text: "Name" }],
    },
  ]);

  return {
    changeLog: null,
    description: null,
    formId: "form-1",
    id: "snapshot-1",
    isActive: true,
    parentVersion: null,
    plateContent,
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    publishedBy: "owner-1",
    structureJson: JSON.stringify({
      version: 1,
      settings: {
        allow_edit_responses: false,
        require_fingerprint: false,
      },
    }),
    title: "Published form",
    validationRulesJson: "[]",
    version: 3,
  };
}

function publicFormRow() {
  return {
    allowEditResponses: false,
    baseSnapshotVersion: 3,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    creatorId: "owner-1",
    description: null,
    dueScheduleId: null,
    id: "form-1",
    plateContent: null,
    plateContentVersion: 1,
    publicId: formState.publicId,
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    status: "PUBLISHED",
    title: "Published form",
    unpublishedAt: null,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    version: 1,
  };
}

function selectRows(condition: EqCondition | undefined) {
  if (!condition) return [];
  if (condition.left === mocks.schema.form.publicId) {
    return condition.right === formState.publicId ? [publicFormRow()] : [];
  }
  if (condition.left === mocks.schema.formResponse.id) {
    return responses.filter((response) => response.id === condition.right);
  }
  if (condition.left === mocks.schema.formResponse.formId) {
    return responses.filter((response) => response.formId === condition.right);
  }
  if (condition.left === mocks.schema.form.id) {
    return condition.right === "form-1" ? [publicFormRow()] : [];
  }
  return [];
}

function selectBuilder() {
  return {
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn((condition: EqCondition) => ({
          limit: vi.fn(() => Promise.resolve(selectRows(condition))),
        })),
      })),
      where: vi.fn((condition: EqCondition) => ({
        for: vi.fn(() => Promise.resolve(selectRows(condition))),
        limit: vi.fn(() => Promise.resolve(selectRows(condition))),
      })),
    })),
  };
}

function transactionClient() {
  return {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: Record<string, unknown>) => {
        if (table === mocks.schema.formResponse) {
          responses.push({
            countryCode: value.countryCode as string | null,
            formId: String(value.formId),
            id: String(value.id),
            responseDataJson: String(value.responseDataJson),
            respondentUuid: String(value.respondentUuid),
            sessionId: value.sessionId as string | null,
            submittedAt: new Date("2026-06-01T00:01:00.000Z"),
            updatedAt: null,
            userAgent: value.userAgent as string | null,
          });
        }
        return Promise.resolve(undefined);
      }),
    })),
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: EqCondition) => {
          if (selection.count) {
            return Promise.resolve([{ count: selectRows(condition).length }]);
          }
          return {
            for: vi.fn(() => Promise.resolve(selectRows(condition))),
          };
        }),
      })),
    })),
  };
}

function installDbMocks() {
  mocks.db.select.mockImplementation(selectBuilder);
  mocks.db.update.mockImplementation(() => ({
    set: vi.fn((values: { publicId?: string }) => ({
      where: vi.fn((condition: EqCondition) => {
        const targetsCurrentForm =
          condition.left === mocks.schema.form.id &&
          condition.right === "form-1";
        if (targetsCurrentForm && values.publicId) {
          formState.publicId = values.publicId;
        }
        return Promise.resolve(undefined);
      }),
    })),
  }));
  mocks.db.transaction.mockImplementation(
    async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
      callback(transactionClient()),
  );
}

async function createApp() {
  const { createHonoApp } = await import("../lib/hono");
  const { formsPublicRouter } = await import("../routes/forms-public");
  const { formsDetailRouter } = await import("../routes/forms-detail");
  return createHonoApp()
    .route("/api/forms", formsPublicRouter)
    .route("/api/forms", formsDetailRouter);
}

describe("public URL regeneration routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    formState.publicId = "old-public-id";
    responses.splice(0, responses.length, {
      countryCode: null,
      formId: "form-1",
      id: "existing-response",
      responseDataJson: JSON.stringify([
        {
          question_id: "question-1",
          question_type: "short_text",
          value: "Before regeneration",
        },
      ]),
      respondentUuid: "existing-respondent",
      sessionId: "session-existing",
      submittedAt: new Date("2026-06-01T00:00:30.000Z"),
      updatedAt: null,
      userAgent: null,
    });
    mocks.randomUUID
      .mockReturnValueOnce("new-public-id")
      .mockReturnValueOnce("new-response-id");
    mocks.getLatestSnapshot.mockResolvedValue(publishedSnapshot());
    mocks.processFormSchedule.mockResolvedValue(undefined);
    mocks.resolveSessionIdOrCreate.mockResolvedValue({
      jwt: "session-jwt",
      sessionId: "session-new",
    });
    mocks.verifyHCaptcha.mockResolvedValue(true);
    installDbMocks();
  });

  it("invalidates the old public URL, keeps existing responses, and accepts submissions on the new URL", async () => {
    const app = await createApp();

    const beforeRegeneration = await app.request(
      "/api/forms/public/old-public-id",
    );
    expect(beforeRegeneration.status).toBe(200);

    const regenerate = await app.request(
      "/api/forms/form-1/regenerate-public-url",
      { method: "POST" },
    );
    expect(regenerate.status).toBe(200);
    await expect(regenerate.json()).resolves.toEqual({
      publicId: "new-public-id",
    });

    const oldPublicGet = await app.request("/api/forms/public/old-public-id");
    expect(oldPublicGet.status).toBe(404);

    const oldPublicSubmit = await app.request(
      "/api/forms/public/old-public-id/submit",
      {
        body: JSON.stringify({
          captchaToken: "captcha-token",
          fingerprints: [],
          responses: [
            {
              question_id: "question-1",
              question_type: "short_text",
              value: "Old URL answer",
            },
          ],
          telemetry: { v4Token: "telemetry-token" },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(oldPublicSubmit.status).toBe(404);

    const newPublicGet = await app.request("/api/forms/public/new-public-id");
    expect(newPublicGet.status).toBe(200);
    await expect(newPublicGet.json()).resolves.toMatchObject({
      form: {
        id: "form-1",
        publicId: "new-public-id",
        status: "PUBLISHED",
      },
    });

    const newPublicSubmit = await app.request(
      "/api/forms/public/new-public-id/submit",
      {
        body: JSON.stringify({
          captchaToken: "captcha-token",
          fingerprints: [],
          responses: [
            {
              question_id: "question-1",
              question_type: "short_text",
              value: "New URL answer",
            },
          ],
          telemetry: { v4Token: "telemetry-token" },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(newPublicSubmit.status).toBe(201);
    await expect(newPublicSubmit.json()).resolves.toMatchObject({
      response: {
        formId: "form-1",
        id: "new-response-id",
      },
    });
    expect(responses).toHaveLength(2);
    expect(responses.map((response) => response.id)).toEqual([
      "existing-response",
      "new-response-id",
    ]);
  });
});
