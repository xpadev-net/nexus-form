import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const queueAdd = vi.fn();
  const inArray = vi.fn();
  const isNull = vi.fn();
  const notInArray = vi.fn();
  const sqlMock = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      strings: Array.from(strings),
      values,
    }),
  ) as unknown as ((
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => unknown) & { join: ReturnType<typeof vi.fn> };
  sqlMock.join = vi.fn((chunks: unknown[], separator: unknown) => ({
    chunks,
    kind: "sql-join",
    separator,
  }));

  return { inArray, isNull, notInArray, queueAdd, set, sqlMock, update, where };
});

vi.mock("@nexus-form/database", () => ({
  db: {
    update: mocks.update,
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {
    id: "externalServiceValidationResult.id",
    status: "externalServiceValidationResult.status",
    lastAttemptAt: "externalServiceValidationResult.lastAttemptAt",
    nextRetryAt: "externalServiceValidationResult.nextRetryAt",
    errorCode: "externalServiceValidationResult.errorCode",
    errorMessage: "externalServiceValidationResult.errorMessage",
    jobId: "externalServiceValidationResult.jobId",
  },
  fingerprintDetail: {},
  form: {},
  formResponse: {},
  formValidationRule: {},
}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    has: vi.fn(() => true),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: mocks.inArray,
  isNull: mocks.isNull,
  ne: vi.fn(),
  notInArray: mocks.notInArray,
  or: vi.fn(),
  sql: mocks.sqlMock,
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshotByVersion: vi.fn(),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(() => []),
}));

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContent: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(() => ({ success: true })),
}));

vi.mock("../lib/forms/validation-results", () => ({
  getExternalValidationResults: vi.fn(() => []),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/queues", () => ({
  getValidationQueue: vi.fn(() => ({ add: mocks.queueAdd })),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/rate-limit", () => {
  const passThrough = async (
    _c: unknown,
    next: () => Promise<void>,
  ): Promise<void> => next();
  return {
    createRateLimit: vi.fn(() => passThrough),
    authRouteRateLimiter: passThrough,
    generalRateLimiter: passThrough,
    invitationSignInRateLimiter: passThrough,
  };
});

vi.mock("../lib/request-body-size-limit", () => ({
  createRequestBodySizeLimit: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../lib/response-data-json", () => ({
  stringifyResponseDataJson: vi.fn(() => "[]"),
}));

function retryTarget(id: string) {
  return {
    id,
    responseId: `response-${id}`,
    ruleId: `rule-${id}`,
    referencedBlockId: `block-${id}`,
    service: "discord",
    status: "FAILED" as const,
    formId: "form-1",
    liveRuleType: "member",
    liveConfigJson: { guildId: "guild-1" },
  };
}

describe("R6-M9: validation retry bulk updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueAdd.mockImplementation(
      async (
        _name: string,
        _data: unknown,
        options: { jobId?: string } | undefined,
      ) => ({
        id: options?.jobId,
      }),
    );
  });

  it("updates enqueued validation retry rows in a single DB round trip", async () => {
    const { enqueueValidationRetries } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRetries([
      retryTarget("result-1"),
      retryTarget("result-2"),
    ]);

    expect(result).toMatchObject({
      enqueuedCount: 2,
      skippedCount: 0,
      jobIds: [
        expect.stringMatching(/^validation-retry:result-1:/),
        expect.stringMatching(/^validation-retry:result-2:/),
      ],
    });
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.where).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.inArray).toHaveBeenCalledWith(
      "externalServiceValidationResult.id",
      ["result-1", "result-2"],
    );
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      1,
      "validate-discord",
      expect.objectContaining({ responseId: "response-result-1" }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-retry:result-1:/),
      }),
    );
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      2,
      "validate-discord",
      expect.objectContaining({ responseId: "response-result-2" }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-retry:result-2:/),
      }),
    );
    const firstJobId = mocks.queueAdd.mock.calls[0]?.[2]?.jobId;
    const secondJobId = mocks.queueAdd.mock.calls[1]?.[2]?.jobId;
    expect(mocks.notInArray).toHaveBeenCalledWith(
      "externalServiceValidationResult.jobId",
      [firstJobId, secondJobId],
    );
    expect(mocks.sqlMock).toHaveBeenCalledWith(
      ["when ", " = ", " then ", ""],
      "externalServiceValidationResult.id",
      "result-1",
      firstJobId,
    );
    expect(mocks.sqlMock).toHaveBeenCalledWith(
      ["when ", " = ", " then ", ""],
      "externalServiceValidationResult.id",
      "result-2",
      secondJobId,
    );
    expect(mocks.sqlMock.join).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          strings: ["when ", " = ", " then ", ""],
          values: [
            "externalServiceValidationResult.id",
            "result-1",
            firstJobId,
          ],
        }),
        expect.objectContaining({
          strings: ["when ", " = ", " then ", ""],
          values: [
            "externalServiceValidationResult.id",
            "result-2",
            secondJobId,
          ],
        }),
      ],
      expect.objectContaining({ strings: [" "] }),
    );
    expect(mocks.sqlMock).toHaveBeenCalledWith(
      ["case ", " else ", " end"],
      expect.objectContaining({ kind: "sql-join" }),
      "externalServiceValidationResult.jobId",
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING",
        errorCode: null,
        errorMessage: null,
        jobId: expect.anything(),
      }),
    );
  });
});
