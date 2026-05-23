import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      id: "externalServiceValidationResult.id",
      jobId: "externalServiceValidationResult.jobId",
    },
    fingerprintDetail: { table: "fingerprintDetail" },
    formValidationRule: {
      id: "formValidationRule.id",
    },
    form: {
      id: "form.id",
      publicId: "form.publicId",
      status: "form.status",
      plateContent: "form.plateContent",
    },
    formIntegration: {
      id: "formIntegration.id",
      formId: "formIntegration.formId",
    },
    formResponse: {
      table: "formResponse",
      id: "formResponse.id",
      formId: "formResponse.formId",
    },
    formSchedule: {
      id: "formSchedule.id",
      formId: "formSchedule.formId",
      processedAt: "formSchedule.processedAt",
      triggerAt: "formSchedule.triggerAt",
    },
    formStructure: {
      formId: "formStructure.formId",
      isActive: "formStructure.isActive",
      structureJson: "formStructure.structureJson",
      version: "formStructure.version",
    },
  };

  return {
    addValidationJob: vi.fn(),
    consumeTokensOrThrow: vi.fn(),
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn(),
    },
    getLatestSnapshot: vi.fn(),
    processFormSchedule: vi.fn(),
    providerRegistryGet: vi.fn(),
    resolveSessionIdOrCreate: vi.fn(),
    schema,
    sequence: [] as string[],
    updateSetValues: [] as unknown[],
    updateWhereValues: [] as unknown[],
    verifyHCaptcha: vi.fn(),
  };
});

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: mocks.providerRegistryGet,
    getAll: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../lib/security/hcaptcha", () => ({
  verifyHCaptcha: mocks.verifyHCaptcha,
}));

vi.mock("../lib/telemetry/tokens", () => ({
  consumeTokensOrThrow: mocks.consumeTokensOrThrow,
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: mocks.processFormSchedule,
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: mocks.getLatestSnapshot,
}));

vi.mock("../lib/sessions/jwt", () => ({
  extractJwtFromRequest: vi.fn().mockReturnValue(null),
  resolveSessionIdOrCreate: mocks.resolveSessionIdOrCreate,
  signSessionJwt: vi.fn().mockReturnValue("session-jwt"),
  verifySessionJwt: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/queues", () => ({
  getSheetsSyncQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: "sheets-job" }),
  })),
  getValidationQueue: vi.fn(() => ({
    add: mocks.addValidationJob,
  })),
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

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  count: vi.fn(() => ({ type: "count" })),
  desc: vi.fn((value: unknown) => ({ type: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    type: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
}));

function useSelectResults(resultSets: unknown[][]): void {
  let callIndex = 0;
  const next = () => Promise.resolve(resultSets[callIndex++] ?? []);
  const createTerminal = () => {
    return {
      limit: vi.fn(next),
      orderBy: vi.fn(() => ({ limit: vi.fn(next) })),
    };
  };

  mocks.db.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({ where: vi.fn(() => createTerminal()) })),
      where: vi.fn((whereValue: unknown) => {
        if (typeof whereValue === "object" && whereValue !== null) {
          const maybeInArray = whereValue as { type?: string };
          if (maybeInArray.type === "inArray") {
            return Promise.resolve(next());
          }
        }
        return createTerminal();
      }),
    })),
  }));
}

function activeSnapshot(
  validationRules: Array<Record<string, unknown>> = [
    {
      id: "rule-1",
      name: "Discord membership",
      providerName: "discord",
      ruleType: "guild_member",
      referencedBlockIds: ["block-1"],
      configJson: { guildId: "guild-1" },
      orderIndex: 0,
    },
  ],
) {
  const plateContent = JSON.stringify([
    {
      type: "form_short_text",
      blockId: "block-1",
      children: [{ text: "Discord handle" }],
    },
  ]);

  return {
    id: "snapshot-1",
    formId: "form-1",
    version: 7,
    isActive: true,
    publishedBy: "owner-1",
    publishedAt: new Date("2026-05-21T00:00:00.000Z"),
    changeLog: null,
    title: "Published form",
    description: null,
    parentVersion: null,
    plateContent,
    validationRulesJson: JSON.stringify(validationRules),
  };
}

function useSuccessfulSubmitSelects(
  snapshot: ReturnType<typeof activeSnapshot>,
  options?: {
    existingRuleIds?: string[];
    responseRows?: unknown[];
  },
) {
  let ruleIdsFromSnapshot: string[] = [];
  try {
    const parsed = JSON.parse(snapshot.validationRulesJson);
    if (Array.isArray(parsed)) {
      ruleIdsFromSnapshot = parsed
        .map((entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "id" in entry &&
          typeof entry.id === "string"
            ? entry.id
            : null,
        )
        .filter((id): id is string => id !== null);
    }
  } catch {
    ruleIdsFromSnapshot = [];
  }
  const existingRuleIds = options?.existingRuleIds ?? ruleIdsFromSnapshot;

  useSelectResults([
    [
      {
        id: "form-1",
        status: "PUBLISHED",
        plateContent: snapshot.plateContent,
        dueScheduleId: null,
      },
    ],
    [
      {
        structureJson: JSON.stringify({
          settings: {
            allow_edit_responses: false,
            require_fingerprint: false,
          },
        }),
      },
    ],
    existingRuleIds.map((id) => ({ id })),
    options?.responseRows ?? [],
  ]);
  mocks.getLatestSnapshot.mockResolvedValue(snapshot);
}

function useTransactionWithInsertCapture() {
  let insertedValidationRows: unknown;
  const txInsert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      if (table === mocks.schema.formResponse) {
        mocks.sequence.push("tx:response");
      }
      if (table === mocks.schema.externalServiceValidationResult) {
        mocks.sequence.push("tx:validation");
        insertedValidationRows = values;
      }
      return values;
    }),
  }));
  mocks.db.transaction.mockImplementation(async (fn) => {
    mocks.sequence.push("tx:start");
    const result = await fn({ insert: txInsert, select: mocks.db.select });
    mocks.sequence.push("tx:commit");
    return result;
  });
  return { getInsertedValidationRows: () => insertedValidationRows, txInsert };
}

async function submitPublicForm() {
  const { formsPublicRouter } = await import("../routes/forms-public");
  return formsPublicRouter.request("/public/public-form-1/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responses: [
        {
          question_id: "block-1",
          question_type: "short_text",
          value: "xpadev",
        },
      ],
      captchaToken: "captcha-token",
      telemetry: { v4Token: "telemetry-token" },
      fingerprints: [],
    }),
  });
}

describe("R11-C2-a public validation outbox", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sequence.length = 0;
    mocks.updateSetValues.length = 0;
    mocks.updateWhereValues.length = 0;
    mocks.verifyHCaptcha.mockResolvedValue(true);
    mocks.consumeTokensOrThrow.mockResolvedValue(undefined);
    mocks.processFormSchedule.mockResolvedValue(null);
    mocks.resolveSessionIdOrCreate.mockResolvedValue({
      sessionId: "session-1",
      jwt: "session-jwt",
    });
    mocks.providerRegistryGet.mockImplementation((name: string) =>
      name === "discord" ? { rules: { guild_member: {} } } : undefined,
    );
    mocks.addValidationJob.mockImplementation(async () => {
      mocks.sequence.push("queue:add");
      return { id: "validation-job-1" };
    });
    mocks.db.update.mockReturnValue({
      set: vi.fn((values: unknown) => {
        mocks.updateSetValues.push(values);
        return {
          where: vi.fn((where: unknown) => {
            mocks.updateWhereValues.push(where);
            return Promise.resolve(undefined);
          }),
        };
      }),
    });
  });

  it("inserts PENDING validation rows in the same transaction as the response before enqueue", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows, txInsert } =
      useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(txInsert).toHaveBeenCalledWith(mocks.schema.formResponse);
    expect(txInsert).toHaveBeenCalledWith(
      mocks.schema.externalServiceValidationResult,
    );
    expect(getInsertedValidationRows()).toEqual([
      expect.objectContaining({
        ruleId: "rule-1",
        referencedBlockId: "block-1",
        snapshotVersion: 7,
        service: "discord",
        status: "PENDING",
      }),
    ]);
    expect(mocks.sequence).toEqual([
      "tx:start",
      "tx:response",
      "tx:validation",
      "tx:commit",
      "queue:add",
    ]);
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        responseId: expect.any(String),
        ruleId: "rule-1",
        referencedBlockId: "block-1",
        snapshotProviderName: "discord",
        snapshotRuleType: "guild_member",
        snapshotVersion: 7,
      }),
    );
  });

  it("skips validation rows for deleted rules so form submission still succeeds", async () => {
    const snapshot = activeSnapshot([
      {
        id: "rule-valid",
        name: "Discord membership",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["block-1"],
        configJson: { guildId: "guild-1" },
        orderIndex: 0,
      },
      {
        id: "rule-deleted",
        name: "Deleted rule",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["block-1"],
        configJson: { guildId: "guild-1" },
        orderIndex: 1,
      },
    ]);
    useSuccessfulSubmitSelects(snapshot, {
      existingRuleIds: ["rule-valid"],
    });
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(getInsertedValidationRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "rule-valid",
          status: "PENDING",
        }),
        expect.objectContaining({
          ruleId: "rule-deleted",
          status: "FAILED",
          errorCode: "RULE_DELETED",
        }),
      ]),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        ruleId: "rule-valid",
      }),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);
  });

  it("persists the enqueue jobId only while the validation row has no jobId", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    await vi.waitFor(() => {
      expect(mocks.updateSetValues).toContainEqual({
        jobId: "validation-job-1",
      });
    });
    expect(mocks.updateWhereValues).toContainEqual(
      expect.objectContaining({
        type: "and",
        args: expect.arrayContaining([
          expect.objectContaining({
            type: "eq",
            left: mocks.schema.externalServiceValidationResult.id,
            right: expect.any(String),
          }),
          expect.objectContaining({
            type: "isNull",
            value: mocks.schema.externalServiceValidationResult.jobId,
          }),
        ]),
      }),
    );
  });

  it("keeps enqueue failures as FAILED ENQUEUE_FAILED after the tx-created PENDING row", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();
    mocks.addValidationJob.mockImplementationOnce(async () => {
      mocks.sequence.push("queue:add");
      throw new Error("Redis unavailable");
    });

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(getInsertedValidationRows()).toEqual([
      expect.objectContaining({ status: "PENDING" }),
    ]);
    await vi.waitFor(() => {
      expect(mocks.updateSetValues).toContainEqual(
        expect.objectContaining({
          status: "FAILED",
          errorCode: "ENQUEUE_FAILED",
          errorMessage: "Failed to enqueue validation job",
        }),
      );
    });
  });

  it("creates non-enqueueable MISSING and FAILED rows in the response transaction", async () => {
    const snapshot = activeSnapshot([
      {
        id: "rule-valid",
        name: "Discord membership",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["block-1"],
        configJson: { guildId: "guild-1" },
        orderIndex: 0,
      },
      {
        id: "rule-missing-block",
        name: "Missing block",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["missing-block"],
        configJson: { guildId: "guild-1" },
        orderIndex: 1,
      },
      {
        id: "rule-unregistered-provider",
        name: "Unregistered provider",
        providerName: "github",
        ruleType: "org_member",
        referencedBlockIds: ["block-1"],
        configJson: { org: "nexus" },
        orderIndex: 2,
      },
      {
        id: "rule-unknown-type",
        name: "Unknown type",
        providerName: "discord",
        ruleType: "unknown_rule",
        referencedBlockIds: ["block-1"],
        configJson: {},
        orderIndex: 3,
      },
    ]);
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(getInsertedValidationRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "rule-valid",
          status: "PENDING",
        }),
        expect.objectContaining({
          ruleId: "rule-missing-block",
          status: "MISSING",
          errorCode: "REFERENCED_BLOCK_MISSING",
        }),
        expect.objectContaining({
          ruleId: "rule-unregistered-provider",
          status: "FAILED",
          errorCode: "PROVIDER_NOT_REGISTERED",
        }),
        expect.objectContaining({
          ruleId: "rule-unknown-type",
          status: "FAILED",
          errorCode: "UNKNOWN_RULE_TYPE",
        }),
      ]),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledOnce();
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({ ruleId: "rule-valid" }),
    );
  });

  it("skips enqueue when every validation row is resolved before queueing", async () => {
    const snapshot = activeSnapshot([
      {
        id: "rule-missing-block",
        name: "Missing block",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["missing-block"],
        configJson: { guildId: "guild-1" },
        orderIndex: 0,
      },
    ]);
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(getInsertedValidationRows()).toEqual([
      expect.objectContaining({
        ruleId: "rule-missing-block",
        status: "MISSING",
        errorCode: "REFERENCED_BLOCK_MISSING",
      }),
    ]);
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    expect(mocks.sequence).toEqual([
      "tx:start",
      "tx:response",
      "tx:validation",
      "tx:commit",
    ]);
  });
});
