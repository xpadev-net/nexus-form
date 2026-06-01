import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      id: "externalServiceValidationResult.id",
      jobId: "externalServiceValidationResult.jobId",
    },
    fingerprintDetail: { table: "fingerprintDetail" },
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
    addSheetsSyncJob: vi.fn(),
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
    add: mocks.addSheetsSyncJob,
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
    structureJson: JSON.stringify({
      version: 1,
      settings: {
        allow_edit_responses: false,
        require_fingerprint: false,
      },
    }),
  };
}

function publicSnapshot(options: {
  title: string;
  version: number;
  blockId: string;
  questionTitle: string;
}) {
  return {
    ...activeSnapshot([]),
    id: `snapshot-${options.version}`,
    version: options.version,
    title: options.title,
    plateContent: JSON.stringify([
      {
        type: "form_short_text",
        blockId: options.blockId,
        children: [{ text: options.questionTitle }],
      },
    ]),
  };
}

function questionNode(
  type: string,
  blockId: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: `form_${type}`,
    blockId,
    ...(validation ? { validation } : {}),
    children: [{ text: `Question ${blockId}` }],
  };
}

function mixedQuestionSnapshot() {
  const rows = [
    { id: "row-a", label: "Row A" },
    { id: "row-b", label: "Row B" },
  ];
  const columns = [
    { id: "col-1", label: "Column 1" },
    { id: "col-2", label: "Column 2" },
  ];

  return {
    ...activeSnapshot([]),
    id: "snapshot-mixed",
    version: 23,
    plateContent: JSON.stringify([
      questionNode("section_separator", "section-main"),
      questionNode("short_text", "q-short", {
        required: true,
        minLength: 2,
        maxLength: 20,
      }),
      questionNode("long_text", "q-long", { required: true }),
      questionNode("radio", "q-radio", {
        required: true,
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      }),
      questionNode("checkbox", "q-checkbox", {
        required: true,
        minSelections: 2,
        maxSelections: 3,
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
          { id: "green", label: "Green" },
        ],
      }),
      questionNode("dropdown", "q-dropdown", {
        required: true,
        options: [
          { id: "jp", label: "Japan" },
          { id: "us", label: "United States" },
        ],
      }),
      questionNode("linear_scale", "q-scale", {
        required: true,
        min: 1,
        max: 5,
      }),
      questionNode("rating", "q-rating", {
        required: true,
        min: 1,
        max: 5,
        maxRating: 5,
      }),
      questionNode("choice_grid", "q-choice-grid", {
        required: true,
        rows,
        columns,
      }),
      questionNode("checkbox_grid", "q-checkbox-grid", {
        required: true,
        rows,
        columns,
        minSelectionsPerRow: 1,
        maxSelectionsPerRow: 2,
      }),
      questionNode("date", "q-date", {
        required: true,
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      }),
      questionNode("time", "q-time", {
        required: true,
        minTime: "09:00",
        maxTime: "17:00",
      }),
    ]),
  };
}

type PublicGetBody = {
  form: { status: string; title: string };
  plateContent: string | null;
};

function usePublicGetSelect(params: {
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  dueScheduleId: string | null;
}) {
  useSelectResults([
    [
      {
        id: "form-1",
        publicId: "public-form-1",
        title: "Schedule form",
        description: null,
        status: params.status,
        dueScheduleId: params.dueScheduleId,
      },
    ],
  ]);
}

async function getPublicForm() {
  const { formsPublicRouter } = await import("../routes/forms-public");
  return formsPublicRouter.request("/public/public-form-1");
}

function useSuccessfulSubmitSelects(
  snapshot: ReturnType<typeof activeSnapshot>,
  options?: {
    responseRows?: unknown[];
  },
) {
  useSelectResults([
    [
      {
        id: "form-1",
        status: "PUBLISHED",
        plateContent: snapshot.plateContent,
        dueScheduleId: null,
      },
    ],
    options?.responseRows ?? [],
  ]);
  mocks.getLatestSnapshot.mockResolvedValue(snapshot);
}

function useTransactionWithInsertCapture() {
  let insertedResponseRow: unknown;
  let insertedValidationRows: unknown;
  const txInsert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      if (table === mocks.schema.formResponse) {
        mocks.sequence.push("tx:response");
        insertedResponseRow = values;
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
  return {
    getInsertedResponseRow: () => insertedResponseRow,
    getInsertedValidationRows: () => insertedValidationRows,
    txInsert,
  };
}

type PublicSubmitResponseItem = {
  question_id: string;
  question_type: string;
  question_title?: string;
  value?: string | number | boolean | null;
  values?: (string | number | boolean)[];
  responses?: Record<string, string | string[]>;
  other_value?: string;
  other_values?: string[];
};

function validMixedResponses(): PublicSubmitResponseItem[] {
  return [
    {
      question_id: "q-short",
      question_type: "short_text",
      value: "Alice",
    },
    {
      question_id: "q-long",
      question_type: "long_text",
      value: "A detailed answer",
    },
    { question_id: "q-radio", question_type: "radio", value: "yes" },
    {
      question_id: "q-checkbox",
      question_type: "checkbox",
      values: ["red", "blue"],
    },
    { question_id: "q-dropdown", question_type: "dropdown", value: "jp" },
    { question_id: "q-scale", question_type: "linear_scale", value: 4 },
    { question_id: "q-rating", question_type: "rating", value: 5 },
    {
      question_id: "q-choice-grid",
      question_type: "choice_grid",
      responses: { "row-a": "col-1", "row-b": "col-2" },
    },
    {
      question_id: "q-checkbox-grid",
      question_type: "checkbox_grid",
      responses: { "row-a": ["col-1"], "row-b": ["col-1", "col-2"] },
    },
    { question_id: "q-date", question_type: "date", value: "2026-06-15" },
    { question_id: "q-time", question_type: "time", value: "10:30" },
  ];
}

async function submitPublicForm(
  responses: PublicSubmitResponseItem[] = [
    {
      question_id: "block-1",
      question_type: "short_text",
      value: "xpadev",
    },
  ],
) {
  const { formsPublicRouter } = await import("../routes/forms-public");
  return formsPublicRouter.request("/public/public-form-1/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responses,
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
    vi.unstubAllEnvs();
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
    mocks.addSheetsSyncJob.mockImplementation(async () => {
      mocks.sequence.push("sheets:add");
      return { id: "sheets-job" };
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

  it("uses published snapshot rules even when draft rules no longer exist", async () => {
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
          ruleId: "rule-deleted",
          status: "PENDING",
        }),
      ]),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        ruleId: "rule-valid",
      }),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        ruleId: "rule-deleted",
      }),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(2);
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

  it("queues Sheets sync with a deterministic colon-free auto job id", async () => {
    const snapshot = activeSnapshot([]);
    useSuccessfulSubmitSelects(snapshot, {
      responseRows: [{ id: "integration:one" }],
    });
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    await vi.waitFor(() => {
      expect(mocks.addSheetsSyncJob).toHaveBeenCalledWith(
        "auto-sync",
        expect.objectContaining({
          formId: "form-1",
          integrationId: "integration:one",
          responseId: expect.any(String),
          snapshotVersion: 7,
        }),
        expect.objectContaining({
          jobId: expect.stringMatching(/^sheets-auto\.[^.]+\.[^.]+$/),
        }),
      );
    });
    const jobId = mocks.addSheetsSyncJob.mock.calls[0]?.[2]?.jobId;
    expect(jobId).not.toContain(":");
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

  it("skips telemetry consumption and required fingerprints in development bypass", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "true");
    const snapshot = activeSnapshot([]);
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
              require_fingerprint: true,
            },
          }),
        },
      ],
      [],
    ]);
    mocks.getLatestSnapshot.mockResolvedValue(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
  });
});

describe("R23-T1 public form input validation submit slice", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
    mocks.providerRegistryGet.mockReturnValue(undefined);
    mocks.addValidationJob.mockResolvedValue({ id: "validation-job-1" });
    mocks.addSheetsSyncJob.mockResolvedValue({ id: "sheets-job" });
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

  it("accepts and stores a valid public submission covering major question types", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedResponseRow } = useTransactionWithInsertCapture();

    const response = await submitPublicForm(responses);

    expect(response.status).toBe(201);
    expect(mocks.consumeTokensOrThrow).toHaveBeenCalledWith([
      "telemetry-token",
    ]);
    expect(getInsertedResponseRow()).toEqual(
      expect.objectContaining({
        formId: "form-1",
        responseDataJson: JSON.stringify(responses),
        sessionId: "session-1",
      }),
    );
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "required text",
      patch: { question_id: "q-short", value: "" },
    },
    {
      name: "scale range",
      patch: { question_id: "q-scale", value: 6 },
    },
    {
      name: "rating range",
      patch: { question_id: "q-rating", value: 0 },
    },
    {
      name: "checkbox selection count",
      patch: { question_id: "q-checkbox", values: ["red"] },
    },
    {
      name: "choice grid required row",
      patch: {
        question_id: "q-choice-grid",
        responses: { "row-a": "col-1", "row-b": "" },
      },
    },
    {
      name: "checkbox grid per-row selection count",
      patch: {
        question_id: "q-checkbox-grid",
        responses: { "row-a": [], "row-b": ["col-1"] },
      },
    },
    {
      name: "date range",
      patch: { question_id: "q-date", value: "2027-01-01" },
    },
    {
      name: "time range",
      patch: { question_id: "q-time", value: "18:00" },
    },
  ])("rejects invalid public submission data for $name", async ({ patch }) => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses().map((response) =>
      response.question_id === patch.question_id
        ? { ...response, ...patch }
        : response,
    );
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm(responses);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid response data");
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
  });
});

describe("R23-T3 scheduled public form visibility", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.processFormSchedule.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the public form hidden before the publish start time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    usePublicGetSelect({ status: "DRAFT", dueScheduleId: null });

    const response = await getPublicForm();

    expect(response.status).toBe(404);
    expect(mocks.processFormSchedule).not.toHaveBeenCalled();
    expect(mocks.getLatestSnapshot).not.toHaveBeenCalled();
  });

  it("shows the scheduled snapshot after the publish start time", async () => {
    const now = new Date("2026-06-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const snapshot = publicSnapshot({
      title: "Launch snapshot",
      version: 1,
      blockId: "start-block",
      questionTitle: "Visible after start",
    });
    usePublicGetSelect({ status: "DRAFT", dueScheduleId: "schedule-start" });
    mocks.processFormSchedule.mockResolvedValueOnce({
      processed: true,
      statusChanged: true,
      newStatus: "PUBLISHED",
      message: "Form automatically published based on schedule",
    });
    mocks.getLatestSnapshot.mockResolvedValueOnce(snapshot);

    const response = await getPublicForm();
    const body = (await response.json()) as PublicGetBody;

    expect(response.status).toBe(200);
    expect(mocks.processFormSchedule).toHaveBeenCalledWith("form-1", now);
    expect(body.form.status).toBe("PUBLISHED");
    expect(body.plateContent).toBe(snapshot.plateContent);
    expect(body.plateContent).toContain("Visible after start");
  });

  it("hides the public form after the scheduled deadline unpublishes it", async () => {
    const now = new Date("2026-06-01T00:02:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    usePublicGetSelect({
      status: "PUBLISHED",
      dueScheduleId: "schedule-deadline",
    });
    mocks.processFormSchedule.mockResolvedValueOnce({
      processed: true,
      statusChanged: true,
      newStatus: "UNPUBLISHED",
      message: "Form automatically unpublished based on schedule",
    });

    const response = await getPublicForm();

    expect(response.status).toBe(404);
    expect(mocks.processFormSchedule).toHaveBeenCalledWith("form-1", now);
    expect(mocks.getLatestSnapshot).not.toHaveBeenCalled();
  });

  it("keeps the form public and serves the switched active snapshot", async () => {
    const now = new Date("2026-06-01T00:03:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const switchedSnapshot = publicSnapshot({
      title: "Switched snapshot",
      version: 2,
      blockId: "switch-block",
      questionTitle: "Visible after snapshot switch",
    });
    usePublicGetSelect({
      status: "PUBLISHED",
      dueScheduleId: "schedule-switch",
    });
    mocks.processFormSchedule.mockResolvedValueOnce({
      processed: true,
      statusChanged: false,
      newStatus: "PUBLISHED",
      message: "Snapshot switched to version 2 based on schedule",
    });
    mocks.getLatestSnapshot.mockResolvedValueOnce(switchedSnapshot);

    const response = await getPublicForm();
    const body = (await response.json()) as PublicGetBody;

    expect(response.status).toBe(200);
    expect(mocks.processFormSchedule).toHaveBeenCalledWith("form-1", now);
    expect(body.form.status).toBe("PUBLISHED");
    expect(body.plateContent).toBe(switchedSnapshot.plateContent);
    expect(body.plateContent).toContain("Visible after snapshot switch");
  });
});
