import { buildValidationOutboxJobId } from "@nexus-form/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      claimToken: "externalServiceValidationResult.claimToken",
      enqueueAttemptCount:
        "externalServiceValidationResult.enqueueAttemptCount",
      enqueueMode: "externalServiceValidationResult.enqueueMode",
      id: "externalServiceValidationResult.id",
      jobId: "externalServiceValidationResult.jobId",
      status: "externalServiceValidationResult.status",
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
    formSession: {
      table: "formSession",
      id: "formSession.id",
    },
    formSubmitOutbox: {
      table: "formSubmitOutbox",
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
    addNotificationJob: vi.fn(),
    addValidationJob: vi.fn(),
    consumeTokensOrThrow: vi
      .fn()
      .mockResolvedValue([{ version: "v4", ipHash: "hash-v4" }]),
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn(),
    },
    extractClientIP: vi.fn(),
    getLatestSnapshot: vi.fn(),
    logError: vi.fn(),
    logWarn: vi.fn(),
    processFormSchedule: vi.fn(),
    providerRegistryGet: vi.fn(),
    recoverSubmitOutboxForResponse: vi.fn(),
    resolveSessionIdOrCreate: vi.fn(),
    schema,
    sequence: [] as string[],
    submitOutboxRows: [] as unknown[],
    integrationRows: [] as unknown[],
    updateSetValues: [] as unknown[],
    updateWhereValues: [] as unknown[],
    verifyHCaptcha: vi.fn(),
  };
});

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  assertRequiredSecurityMigrationsApplied: vi.fn().mockResolvedValue(undefined),
  runMigrations: vi.fn(),
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
  hashIPAddress: (ip: string) => `hash:${ip}`,
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: mocks.processFormSchedule,
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: mocks.getLatestSnapshot,
}));

vi.mock("../lib/forms/submit-outbox-sweeper", () => ({
  insertSubmitOutboxRows: vi.fn(async (_tx: unknown, rows: unknown[]) => {
    mocks.sequence.push("tx:submit-outbox");
    mocks.submitOutboxRows.push(...rows);
  }),
  recoverSubmitOutboxForResponse: mocks.recoverSubmitOutboxForResponse,
}));

vi.mock("../lib/sessions/jwt", () => ({
  extractJwtFromRequest: vi.fn().mockReturnValue(null),
  hashIp: vi.fn().mockReturnValue("ip-hash"),
  resolveSessionIdOrCreate: mocks.resolveSessionIdOrCreate,
  signSessionJwt: vi.fn().mockReturnValue("session-jwt"),
  verifySessionJwt: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/queues", () => ({
  getFormSubmitNotificationQueue: vi.fn(() => ({
    add: mocks.addNotificationJob,
  })),
  getSheetsSyncQueue: vi.fn(() => ({
    add: mocks.addSheetsSyncJob,
  })),
  getValidationQueue: vi.fn(() => ({
    add: mocks.addValidationJob,
  })),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/ip-address", () => ({
  extractClientIP: mocks.extractClientIP,
}));

vi.mock("../lib/logger", () => ({
  logError: mocks.logError,
  logInfo: vi.fn(),
  logWarn: mocks.logWarn,
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

function sectionBranchingSnapshot() {
  return {
    ...activeSnapshot([]),
    id: "snapshot-branching",
    version: 31,
    plateContent: JSON.stringify([
      questionNode("radio", "q-entity-type", {
        required: true,
        options: [
          { id: "individual", label: "Individual" },
          { id: "corporate", label: "Corporate" },
        ],
      }),
      questionNode("section_separator", "section-corporate", {
        navigation_rules: [
          {
            id: "rule-corporate",
            name: "Corporate branch",
            conditions: [
              {
                question_id: "q-entity-type",
                operator: "equals",
                value: "corporate",
              },
            ],
            condition_match: "all",
            action: {
              type: "jump_to_section",
              target_id: "section-corporate",
            },
            enabled: true,
          },
        ],
        default_action: { type: "submit" },
      }),
      questionNode("short_text", "q-company-name", {
        required: true,
      }),
    ]),
  };
}

function checkboxBranchingSnapshot() {
  return {
    ...activeSnapshot([]),
    id: "snapshot-checkbox-branching",
    version: 32,
    plateContent: JSON.stringify([
      questionNode("checkbox", "q-plan", {
        required: false,
        options: [
          { id: "basic", label: "Basic" },
          { id: "premium", label: "Premium" },
        ],
      }),
      questionNode("section_separator", "section-premium", {
        navigation_rules: [
          {
            id: "rule-premium",
            name: "Premium branch",
            conditions: [
              {
                question_id: "q-plan",
                operator: "includes_all",
                value: ["premium"],
              },
            ],
            condition_match: "all",
            action: {
              type: "jump_to_section",
              target_id: "section-premium",
            },
            enabled: true,
          },
        ],
        default_action: { type: "submit" },
      }),
      questionNode("short_text", "q-premium-note", {
        required: true,
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
    finalResponseRows?: unknown[];
    responseRows?: unknown[];
  },
) {
  mocks.integrationRows = options?.responseRows ?? [];
  useSelectResults([
    [
      {
        id: "form-1",
        status: "PUBLISHED",
        plateContent: snapshot.plateContent,
        dueScheduleId: null,
      },
    ],
    mocks.integrationRows,
    options?.finalResponseRows ?? [],
  ]);
  mocks.getLatestSnapshot.mockResolvedValue(snapshot);
}

function useTransactionWithInsertCapture(options?: {
  onValidationRows?: (rows: unknown) => void;
}) {
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
        options?.onValidationRows?.(values);
      }
      return values;
    }),
  }));
  const txSelect = vi.fn((_selection: { id?: unknown }) => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (table === mocks.schema.formIntegration) {
            return mocks.integrationRows;
          }
          return [];
        }),
        for: vi.fn(async () => []),
      })),
    })),
  }));
  const txUpdate = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  }));
  const transactionClient = {
    insert: txInsert,
    select: txSelect,
    update: txUpdate,
  };
  mocks.db.transaction.mockImplementation(async (fn) => {
    mocks.sequence.push("tx:start");
    const result = await fn(transactionClient);
    mocks.sequence.push("tx:commit");
    return result;
  });
  return {
    getInsertedResponseRow: () => insertedResponseRow,
    getInsertedValidationRows: () => insertedValidationRows,
    transactionClient,
    txInsert,
    txSelect,
  };
}

function getSingleValidationResultId(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Expected exactly one inserted validation result");
  }
  const [row] = rows;
  if (
    typeof row !== "object" ||
    row === null ||
    !("id" in row) ||
    typeof row.id !== "string"
  ) {
    throw new Error("Expected inserted validation result to have a string id");
  }
  return row.id;
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

function getStoredResponseDataJson(row: unknown): string {
  if (typeof row === "object" && row !== null && "responseDataJson" in row) {
    const value = row.responseDataJson;
    if (typeof value === "string") {
      return value;
    }
  }

  throw new Error("Inserted response row did not include responseDataJson");
}

async function submitPublicForm(
  responses: PublicSubmitResponseItem[] = [
    {
      question_id: "block-1",
      question_type: "short_text",
      value: "xpadev",
    },
  ],
  headers: Record<string, string> = {},
  telemetry: { v4Token?: string; v6Token?: string } = {
    v4Token: "telemetry-token",
  },
) {
  const { formsPublicRouter } = await import("../routes/forms-public");
  return formsPublicRouter.request("/public/public-form-1/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      responses,
      captchaToken: "captcha-token",
      telemetry,
      fingerprints: [],
    }),
  });
}

function resetPublicSubmitMocks(
  options: {
    providerRegistryGet?: (name: string) => unknown;
    trackQueueSequence?: boolean;
  } = {},
) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.sequence.length = 0;
  mocks.submitOutboxRows.length = 0;
  mocks.integrationRows.length = 0;
  mocks.updateSetValues.length = 0;
  mocks.updateWhereValues.length = 0;
  mocks.extractClientIP.mockImplementation(
    (_request: unknown, options: { strategy: "telemetry" | "general" }) => {
      if (options.strategy === "telemetry") {
        return { ip: "203.0.113.10", source: "x-nginx-forwarded-for" };
      }

      return { ip: "203.0.113.10", source: "x-forwarded-for" };
    },
  );
  mocks.verifyHCaptcha.mockResolvedValue(true);
  mocks.consumeTokensOrThrow.mockResolvedValue([
    { version: "v4", ipHash: "hash-v4" },
  ]);
  mocks.processFormSchedule.mockResolvedValue(null);
  mocks.resolveSessionIdOrCreate.mockResolvedValue({
    sessionId: "session-1",
    jwt: "session-jwt",
  });
  if (options.providerRegistryGet) {
    mocks.providerRegistryGet.mockImplementation((name: string) =>
      options.providerRegistryGet?.(name),
    );
  } else {
    mocks.providerRegistryGet.mockReturnValue(undefined);
  }
  if (options.trackQueueSequence) {
    mocks.addNotificationJob.mockImplementation(async () => {
      mocks.sequence.push("notification:add");
      return { id: "notification-job-1" };
    });
    mocks.addValidationJob.mockImplementation(async () => {
      mocks.sequence.push("queue:add");
      return { id: "validation-job-1" };
    });
    mocks.addSheetsSyncJob.mockImplementation(async () => {
      mocks.sequence.push("sheets:add");
      return { id: "sheets-job" };
    });
  } else {
    mocks.addNotificationJob.mockResolvedValue({ id: "notification-job-1" });
    mocks.addValidationJob.mockResolvedValue({ id: "validation-job-1" });
    mocks.addSheetsSyncJob.mockResolvedValue({ id: "sheets-job" });
  }
  mocks.db.update.mockReturnValue({
    set: vi.fn((values: unknown) => {
      mocks.updateSetValues.push(values);
      return {
        where: vi.fn((where: unknown) => {
          mocks.updateWhereValues.push(where);
          return Promise.resolve([{ affectedRows: 1 }]);
        }),
      };
    }),
  });
}

function useValidationUpdateResults(
  results: Array<() => Promise<unknown>>,
): void {
  let resultIndex = 0;
  mocks.db.update.mockReturnValue({
    set: vi.fn((values: unknown) => {
      mocks.updateSetValues.push(values);
      return {
        where: vi.fn((where: unknown) => {
          mocks.updateWhereValues.push(where);
          const result = results[resultIndex];
          resultIndex += 1;
          if (!result) {
            throw new Error("Missing validation update result");
          }
          return result();
        }),
      };
    }),
  });
}

type RuntimeValidationOutboxRow = {
  id: string | null;
  status: "PENDING" | "FAILED";
  enqueueMode: "LEGACY" | "STABLE";
  enqueueAttemptCount: number;
  jobId: string | null;
  claimToken: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readValidationOutboxOperand(
  row: RuntimeValidationOutboxRow,
  operand: unknown,
): unknown {
  switch (operand) {
    case mocks.schema.externalServiceValidationResult.id:
      return row.id;
    case mocks.schema.externalServiceValidationResult.status:
      return row.status;
    case mocks.schema.externalServiceValidationResult.enqueueMode:
      return row.enqueueMode;
    case mocks.schema.externalServiceValidationResult.enqueueAttemptCount:
      return row.enqueueAttemptCount;
    case mocks.schema.externalServiceValidationResult.jobId:
      return row.jobId;
    case mocks.schema.externalServiceValidationResult.claimToken:
      return row.claimToken;
    default:
      return operand;
  }
}

function matchesValidationOutboxPredicate(
  row: RuntimeValidationOutboxRow,
  predicate: unknown,
): boolean {
  if (!isRecord(predicate) || typeof predicate.type !== "string") {
    return false;
  }

  if (predicate.type === "and") {
    return (
      Array.isArray(predicate.args) &&
      predicate.args.every((entry) =>
        matchesValidationOutboxPredicate(row, entry),
      )
    );
  }
  if (predicate.type === "eq") {
    return (
      readValidationOutboxOperand(row, predicate.left) ===
      readValidationOutboxOperand(row, predicate.right)
    );
  }
  if (predicate.type === "isNull") {
    return readValidationOutboxOperand(row, predicate.value) === null;
  }
  return false;
}

function applyValidationOutboxSet(
  row: RuntimeValidationOutboxRow,
  values: unknown,
): void {
  if (!isRecord(values)) return;

  if (typeof values.enqueueAttemptCount === "number") {
    row.enqueueAttemptCount = values.enqueueAttemptCount;
  }
  if (typeof values.jobId === "string") row.jobId = values.jobId;
  if (values.claimToken === null) row.claimToken = null;
  if (values.status === "PENDING" || values.status === "FAILED") {
    row.status = values.status;
  }
  if (typeof values.errorCode === "string" || values.errorCode === null) {
    row.errorCode = values.errorCode;
  }
  if (typeof values.errorMessage === "string" || values.errorMessage === null) {
    row.errorMessage = values.errorMessage;
  }
}

function useStatefulValidationOutboxUpdates(
  row: RuntimeValidationOutboxRow,
  options: { failJobIdAcknowledgementOnce?: boolean } = {},
): void {
  let failJobIdAcknowledgement = options.failJobIdAcknowledgementOnce === true;

  mocks.db.update.mockImplementation(() => ({
    set: vi.fn((values: unknown) => {
      mocks.updateSetValues.push(values);
      return {
        where: vi.fn(async (where: unknown) => {
          mocks.updateWhereValues.push(where);
          if (!matchesValidationOutboxPredicate(row, where)) {
            return [{ affectedRows: 0 }];
          }
          if (
            failJobIdAcknowledgement &&
            isRecord(values) &&
            typeof values.jobId === "string"
          ) {
            failJobIdAcknowledgement = false;
            throw new Error("database unavailable");
          }

          applyValidationOutboxSet(row, values);
          return [{ affectedRows: 1 }];
        }),
      };
    }),
  }));
}

describe("R11-C2-a public validation outbox", () => {
  beforeEach(() => {
    resetPublicSubmitMocks({
      providerRegistryGet: (name: string) =>
        name === "discord" ? { rules: { guild_member: {} } } : undefined,
      trackQueueSequence: true,
    });
  });

  it("inserts PENDING validation rows in the same transaction as the response before enqueue", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows, transactionClient, txInsert } =
      useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(txInsert).toHaveBeenCalledWith(mocks.schema.formResponse);
    expect(txInsert).toHaveBeenCalledWith(
      mocks.schema.externalServiceValidationResult,
    );
    expect(mocks.resolveSessionIdOrCreate).toHaveBeenCalledWith(
      null,
      { ip: "203.0.113.10", ua: undefined },
      transactionClient,
    );
    expect(getInsertedValidationRows()).toEqual([
      expect.objectContaining({
        enqueueMode: "STABLE",
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
      "tx:submit-outbox",
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
      {
        jobId: buildValidationOutboxJobId(
          getSingleValidationResultId(getInsertedValidationRows()),
        ),
      },
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
    useSuccessfulSubmitSelects(snapshot, {
      finalResponseRows: [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-06-03T12:34:56.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: "session-1",
          countryCode: null,
        },
      ],
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
          status: "PENDING",
        }),
      ]),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        ruleId: "rule-valid",
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-outbox-/),
      }),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        ruleId: "rule-deleted",
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-outbox-/),
      }),
    );
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(2);
  });

  it("persists the shared stable jobId only while the STABLE row remains unclaimed", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot, {
      finalResponseRows: [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-06-03T12:34:56.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: "session-1",
          countryCode: null,
        },
      ],
    });
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();

    const response = await submitPublicForm();
    const expectedJobId = buildValidationOutboxJobId(
      getSingleValidationResultId(getInsertedValidationRows()),
    );

    expect(response.status).toBe(201);
    await vi.waitFor(() => {
      expect(mocks.updateSetValues).toContainEqual({
        enqueueAttemptCount: 1,
      });
      expect(mocks.updateSetValues).toContainEqual({
        jobId: expectedJobId,
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
          expect.objectContaining({
            type: "eq",
            left: mocks.schema.externalServiceValidationResult.status,
            right: "PENDING",
          }),
          expect.objectContaining({
            type: "eq",
            left: mocks.schema.externalServiceValidationResult.enqueueMode,
            right: "STABLE",
          }),
          expect.objectContaining({
            type: "isNull",
            value: mocks.schema.externalServiceValidationResult.claimToken,
          }),
        ]),
      }),
    );
    expect(mocks.updateWhereValues).toContainEqual(
      expect.objectContaining({
        type: "and",
        args: expect.arrayContaining([
          expect.objectContaining({
            type: "eq",
            left: mocks.schema.externalServiceValidationResult
              .enqueueAttemptCount,
            right: 0,
          }),
        ]),
      }),
    );
  });

  it("keeps queue success recoverable when the jobId acknowledgement throws", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    const runtimeRow: RuntimeValidationOutboxRow = {
      id: null,
      status: "PENDING",
      enqueueMode: "STABLE",
      enqueueAttemptCount: 0,
      jobId: null,
      claimToken: null,
      errorCode: null,
      errorMessage: null,
    };
    const { getInsertedValidationRows } = useTransactionWithInsertCapture({
      onValidationRows: (rows) => {
        runtimeRow.id = getSingleValidationResultId(rows);
      },
    });
    useStatefulValidationOutboxUpdates(runtimeRow, {
      failJobIdAcknowledgementOnce: true,
    });

    const response = await submitPublicForm();
    const expectedJobId = buildValidationOutboxJobId(
      getSingleValidationResultId(getInsertedValidationRows()),
    );

    expect(response.status).toBe(201);
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({ ruleId: "rule-1" }),
      { jobId: expectedJobId },
    );
    await vi.waitFor(() => {
      expect(mocks.logError).toHaveBeenCalledWith(
        "Failed to persist jobId for validation result",
        "api",
        expect.objectContaining({
          error: expect.objectContaining({ message: "database unavailable" }),
          jobId: expectedJobId,
        }),
      );
    });
    expect(mocks.updateSetValues).toEqual([
      { enqueueAttemptCount: 1 },
      { jobId: expectedJobId },
    ]);
    expect(runtimeRow).toMatchObject({
      id: getSingleValidationResultId(getInsertedValidationRows()),
      status: "PENDING",
      enqueueMode: "STABLE",
      enqueueAttemptCount: 1,
      jobId: null,
      claimToken: null,
    });
    expect(mocks.updateSetValues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: expect.any(String) }),
      ]),
    );
  });

  it("keeps queue success recoverable when the jobId acknowledgement CAS matches no row", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();
    useValidationUpdateResults([
      () => Promise.resolve([{ affectedRows: 1 }]),
      () => Promise.resolve([{ affectedRows: 0 }]),
    ]);

    const response = await submitPublicForm();
    const expectedJobId = buildValidationOutboxJobId(
      getSingleValidationResultId(getInsertedValidationRows()),
    );

    expect(response.status).toBe(201);
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({ ruleId: "rule-1" }),
      { jobId: expectedJobId },
    );
    await vi.waitFor(() => {
      expect(mocks.updateSetValues).toEqual([
        { enqueueAttemptCount: 1 },
        { jobId: expectedJobId },
      ]);
    });
    expect(mocks.updateSetValues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: expect.any(String) }),
      ]),
    );
  });

  it("keeps initial attempt reservation exceptions recoverable without queueing", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();
    useValidationUpdateResults([
      () => Promise.reject(new Error("database unavailable")),
    ]);

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mocks.logError).toHaveBeenCalledWith(
        "Failed to reserve initial validation enqueue attempt",
        "api",
        expect.objectContaining({
          error: expect.objectContaining({ message: "database unavailable" }),
        }),
      );
    });
    expect(mocks.updateSetValues).toEqual([{ enqueueAttemptCount: 1 }]);
    expect(mocks.updateSetValues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: expect.any(String) }),
      ]),
    );
  });

  it("keeps initial attempt reservation CAS0 recoverable without queueing", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();
    useValidationUpdateResults([() => Promise.resolve([{ affectedRows: 0 }])]);

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    await vi.waitFor(() => {
      expect(mocks.updateSetValues).toEqual([{ enqueueAttemptCount: 1 }]);
    });
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    expect(mocks.updateSetValues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: expect.any(String) }),
      ]),
    );
  });

  it("persists Sheets sync with a deterministic colon-free auto job id", async () => {
    const snapshot = activeSnapshot([]);
    useSuccessfulSubmitSelects(snapshot, {
      responseRows: [{ id: "integration:one" }],
    });
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.submitOutboxRows).toEqual([
      expect.objectContaining({
        formId: "form-1",
        integrationId: "integration:one",
        responseId: expect.any(String),
        snapshotVersion: 7,
        effectType: "SHEETS",
        id: expect.stringMatching(/^sheets-auto\.[^.]+\.[^.]+$/),
      }),
    ]);
    const jobId = (mocks.submitOutboxRows[0] as { id: string }).id;
    expect(jobId).not.toContain(":");
    expect(mocks.recoverSubmitOutboxForResponse).toHaveBeenCalledWith(
      expect.any(String),
    );
  });

  it("persists only enabled submit notification intent after a successful response", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
        },
        notifications: {
          on_submit: {
            email: {
              enabled: false,
              recipients: ["owner@example.com"],
            },
            discord: {
              enabled: true,
              webhook_url: "https://discord.com/api/webhooks/123/discord-token",
              message_template: "new response {{response_id}}",
            },
            webhook: {
              enabled: false,
              url: "https://zapier.com/hooks/catch/current",
              secret: "current-secret-current-secret-123456",
            },
          },
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot, {
      finalResponseRows: [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-06-03T12:34:56.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: "session-1",
          countryCode: null,
        },
      ],
    });
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.submitOutboxRows).toEqual([
      expect.objectContaining({
        formId: "form-1",
        responseId: expect.any(String),
        snapshotVersion: 7,
        effectType: "NOTIFICATION",
        integrationId: null,
        id: expect.stringMatching(/^form-submit-notification\.[^.]+\.[^.]+$/),
      }),
    ]);
    const outboxJson = JSON.stringify(mocks.submitOutboxRows);
    expect(outboxJson).not.toContain("discord-token");
    expect(outboxJson).not.toContain("current-secret");
  });

  it("persists notification intent even when the post-commit response read is unavailable", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
        },
        notifications: {
          on_submit: {
            discord: {
              enabled: true,
              webhook_url: "https://discord.com/api/webhooks/123/discord-token",
            },
          },
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot, { finalResponseRows: [] });
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.submitOutboxRows).toEqual([
      expect.objectContaining({ effectType: "NOTIFICATION" }),
    ]);
  });

  it("does not queue submit notifications when every channel is off", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
        },
        notifications: {
          on_submit: {
            email: {
              enabled: false,
              recipients: ["owner@example.com"],
            },
            discord: {
              enabled: false,
              webhook_url: "https://discord.com/api/webhooks/123/discord-token",
            },
            webhook: {
              enabled: false,
              url: "https://zapier.com/hooks/catch/current",
              secret: "current-secret-current-secret-123456",
            },
          },
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot, {
      finalResponseRows: [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-06-03T12:34:56.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: "session-1",
          countryCode: null,
        },
      ],
    });
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.submitOutboxRows).toEqual([]);
  });

  it("keeps submit success independent from immediate notification recovery", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
        },
        notifications: {
          on_submit: {
            webhook: {
              enabled: true,
              url: "https://zapier.com/hooks/catch/current",
              secret: "current-secret-current-secret-123456",
              timeout_seconds: 30,
              retry_attempts: 1,
            },
          },
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot, {
      finalResponseRows: [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-06-03T12:34:56.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: "session-1",
          countryCode: null,
        },
      ],
    });
    useTransactionWithInsertCapture();
    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(mocks.submitOutboxRows).toEqual([
      expect.objectContaining({ effectType: "NOTIFICATION" }),
    ]);
    expect(mocks.recoverSubmitOutboxForResponse).toHaveBeenCalledOnce();
  });

  it("rejects at the response limit without creating an unreachable session", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
          response_limit: {
            enabled: true,
            max_responses: 1,
            message: "Closed",
          },
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot);
    const txInsert = vi.fn(() => ({
      values: vi.fn(async () => undefined),
    }));
    const txSelect = vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          if ("count" in selection) {
            return Promise.resolve([{ count: 1 }]);
          }
          return { for: vi.fn(async () => []) };
        }),
      })),
    }));
    mocks.db.transaction.mockImplementation(async (callback) =>
      callback({ select: txSelect, insert: txInsert }),
    );

    const response = await submitPublicForm();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Closed",
      responseLimitReached: true,
    });
    expect(txInsert).not.toHaveBeenCalled();
    expect(mocks.resolveSessionIdOrCreate).not.toHaveBeenCalled();
    expect(mocks.submitOutboxRows).toEqual([]);
    expect(mocks.recoverSubmitOutboxForResponse).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rolls back a newly created session when a later response insert fails", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot);
    const committedSessions: unknown[] = [];
    const txInsert = vi.fn((table: unknown) => ({
      values: vi.fn(async (values: unknown) => {
        if (table === mocks.schema.formResponse) {
          throw new Error("response insert failed");
        }
        return values;
      }),
    }));
    mocks.db.transaction.mockImplementation(async (callback) => {
      const pendingSessions: unknown[] = [];
      const insert = vi.fn((table: unknown) => ({
        values: vi.fn(async (values: unknown) => {
          if (table === mocks.schema.formSession) {
            pendingSessions.push(values);
          }
          return txInsert(table).values(values);
        }),
      }));
      const result = await callback({
        insert,
        select: vi.fn(),
        update: vi.fn(),
      });
      committedSessions.push(...pendingSessions);
      return result;
    });
    mocks.resolveSessionIdOrCreate.mockImplementationOnce(
      async (_jwtToken, _meta, executor) => {
        await executor.insert(mocks.schema.formSession).values({
          id: "session-rollback",
        });
        return { sessionId: "session-rollback", jwt: "session-jwt" };
      },
    );

    const response = await submitPublicForm();

    expect(response.status).toBe(500);
    expect(txInsert).toHaveBeenNthCalledWith(1, mocks.schema.formSession);
    expect(txInsert).toHaveBeenNthCalledWith(2, mocks.schema.formResponse);
    expect(committedSessions).toEqual([]);
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.resolveSessionIdOrCreate).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the published confirmation snapshot with the created response", async () => {
    const snapshot = {
      ...activeSnapshot([]),
      structureJson: JSON.stringify({
        version: 1,
        settings: {
          allow_edit_responses: false,
          require_fingerprint: false,
        },
        confirmation: {
          title: "送信ありがとうございます",
          message: "受付が完了しました。",
          supplemental_link: {
            label: "次の手順",
            url: "https://example.com/next",
          },
          contact: { label: "問い合わせ", email: "help@example.com" },
          redirect_url: "https://example.com/done",
        },
      }),
    };
    useSuccessfulSubmitSelects(snapshot, {
      finalResponseRows: [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: "[]",
          submittedAt: new Date("2026-06-03T00:00:00.000Z"),
          updatedAt: null,
          respondentUuid: "respondent-1",
          userAgent: null,
          sessionId: "session-1",
          countryCode: null,
        },
      ],
    });
    useTransactionWithInsertCapture();

    const response = await submitPublicForm();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      confirmation: {
        title: "送信ありがとうございます",
        message: "受付が完了しました。",
        supplemental_link: {
          label: "次の手順",
          url: "https://example.com/next",
        },
        contact: { label: "問い合わせ", email: "help@example.com" },
        redirect_url: "https://example.com/done",
        show_response_summary: false,
        show_response_id: true,
        allow_edit_link: false,
      },
      responseId: expect.any(String),
      response: expect.objectContaining({ id: "response-1" }),
    });
  });

  it("keeps transient enqueue failures as recoverable STABLE PENDING rows", async () => {
    const snapshot = activeSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    const runtimeRow: RuntimeValidationOutboxRow = {
      id: null,
      status: "PENDING",
      enqueueMode: "STABLE",
      enqueueAttemptCount: 0,
      jobId: null,
      claimToken: null,
      errorCode: null,
      errorMessage: null,
    };
    const { getInsertedValidationRows } = useTransactionWithInsertCapture({
      onValidationRows: (rows) => {
        runtimeRow.id = getSingleValidationResultId(rows);
      },
    });
    useStatefulValidationOutboxUpdates(runtimeRow);
    mocks.addValidationJob.mockImplementationOnce(async () => {
      mocks.sequence.push("queue:add");
      throw new Error("Redis unavailable");
    });

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(getInsertedValidationRows()).toEqual([
      expect.objectContaining({ enqueueMode: "STABLE", status: "PENDING" }),
    ]);
    await vi.waitFor(() => {
      expect(mocks.logError).toHaveBeenCalledWith(
        "Failed to enqueue external validation job",
        "api",
        expect.objectContaining({
          error: expect.objectContaining({ message: "Redis unavailable" }),
          jobId: expect.stringMatching(/^validation-outbox-/),
        }),
      );
    });
    expect(mocks.updateSetValues).toEqual([{ enqueueAttemptCount: 1 }]);
    expect(runtimeRow).toEqual({
      id: getSingleValidationResultId(getInsertedValidationRows()),
      status: "PENDING",
      enqueueMode: "STABLE",
      enqueueAttemptCount: 1,
      jobId: null,
      claimToken: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({ ruleId: "rule-1" }),
      {
        jobId: buildValidationOutboxJobId(
          getSingleValidationResultId(getInsertedValidationRows()),
        ),
      },
    );
  });

  it("marks deterministic validation job preparation failures terminal", async () => {
    const snapshot = { ...activeSnapshot(), version: 0 };
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedValidationRows } = useTransactionWithInsertCapture();

    const response = await submitPublicForm();

    expect(response.status).toBe(201);
    expect(getInsertedValidationRows()).toEqual([
      expect.objectContaining({
        enqueueMode: "STABLE",
        snapshotVersion: 0,
        status: "PENDING",
      }),
    ]);
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mocks.updateSetValues).toContainEqual({
        status: "FAILED",
        errorCode: "ENQUEUE_FAILED",
        errorMessage: "Failed to prepare validation job",
      });
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
          enqueueMode: "STABLE",
          ruleId: "rule-valid",
          status: "PENDING",
        }),
        expect.objectContaining({
          enqueueMode: "STABLE",
          ruleId: "rule-missing-block",
          status: "MISSING",
          errorCode: "REFERENCED_BLOCK_MISSING",
        }),
        expect.objectContaining({
          enqueueMode: "STABLE",
          ruleId: "rule-unregistered-provider",
          status: "FAILED",
          errorCode: "PROVIDER_NOT_REGISTERED",
        }),
        expect.objectContaining({
          enqueueMode: "STABLE",
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
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-outbox-/),
      }),
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
      "tx:submit-outbox",
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
        // Created response lookup. Empty rows keep the response body nullable
        // while still allowing fail-open background jobs to run.
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
    resetPublicSubmitMocks();
  });

  it("accepts and stores a valid public submission covering major question types", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    const { getInsertedResponseRow } = useTransactionWithInsertCapture();

    const response = await submitPublicForm(responses);

    expect(response.status).toBe(201);
    expect(mocks.consumeTokensOrThrow).toHaveBeenCalledWith(
      ["telemetry-token"],
      "203.0.113.10",
    );
    expect(getInsertedResponseRow()).toEqual(
      expect.objectContaining({
        formId: "form-1",
        sessionId: "session-1",
      }),
    );
    expect(
      JSON.parse(getStoredResponseDataJson(getInsertedResponseRow())),
    ).toEqual(responses);
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
  });

  it("rejects a public submission when telemetry token IP binding fails", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();
    mocks.consumeTokensOrThrow.mockRejectedValueOnce(
      new Error("Invalid, expired, or IP-mismatched telemetry tokens"),
    );

    const response = await submitPublicForm(responses);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or expired telemetry tokens",
    });
    expect(mocks.consumeTokensOrThrow).toHaveBeenCalledWith(
      ["telemetry-token"],
      "203.0.113.10",
    );
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("allows v4 and v6 telemetry candidates to be validated with any matching token", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm(
      responses,
      {},
      {
        v4Token: "v4-token",
        v6Token: "v6-token",
      },
    );

    expect(response.status).toBe(201);
    expect(mocks.consumeTokensOrThrow).toHaveBeenCalledWith(
      ["v4-token", "v6-token"],
      "203.0.113.10",
    );
  });

  it("uses the general API IP boundary for token consumption instead of the telemetry boundary", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();
    mocks.extractClientIP.mockImplementation(
      (_request: unknown, options: { strategy: "telemetry" | "general" }) => {
        if (options.strategy === "telemetry") {
          return { ip: "unknown", source: "unknown" };
        }

        return { ip: "203.0.113.10", source: "x-forwarded-for" };
      },
    );

    const response = await submitPublicForm(responses);

    expect(response.status).toBe(201);
    expect(mocks.extractClientIP).toHaveBeenCalledWith(expect.any(Request), {
      strategy: "general",
    });
    expect(mocks.extractClientIP).not.toHaveBeenCalledWith(
      expect.any(Request),
      {
        strategy: "telemetry",
      },
    );
    expect(mocks.consumeTokensOrThrow).toHaveBeenCalledWith(
      ["telemetry-token"],
      "203.0.113.10",
    );
  });

  it("rejects divergent submit and telemetry header boundaries before consuming tokens", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();
    mocks.extractClientIP.mockImplementation(
      (_request: unknown, options: { strategy: "telemetry" | "general" }) => {
        if (options.strategy === "telemetry") {
          return { ip: "198.51.100.20", source: "x-nginx-forwarded-for" };
        }

        return { ip: "203.0.113.10", source: "x-forwarded-for" };
      },
    );

    const response = await submitPublicForm(responses, {
      "x-forwarded-for": "203.0.113.10",
      "x-nginx-forwarded-for": "198.51.100.20",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Unable to determine client IP",
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "POST: telemetry token IP header mismatch",
      "forms-public",
      {
        publicId: "public-form-1",
        submitSource: "x-forwarded-for",
        submitStrategy: "general",
        telemetrySource: "x-nginx-forwarded-for",
        telemetryStrategy: "telemetry",
      },
    );
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
  });

  it("rejects telemetry tokens before consumption when the general API boundary cannot determine the current IP", async () => {
    const snapshot = mixedQuestionSnapshot();
    const responses = validMixedResponses();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();
    mocks.extractClientIP.mockImplementation(
      (_request: unknown, options: { strategy: "telemetry" | "general" }) => {
        if (options.strategy === "telemetry") {
          return { ip: "198.51.100.20", source: "x-nginx-forwarded-for" };
        }

        return { ip: "unknown", source: "unknown" };
      },
    );

    const response = await submitPublicForm(responses);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to determine client IP",
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "POST: telemetry token IP detection failed",
      "forms-public",
      expect.objectContaining({
        publicId: "public-form-1",
        source: "unknown",
        strategy: "general",
      }),
    );
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
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

    const response = await submitPublicForm(responses);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid response data");
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
  });

  it("rejects unreachable branch answers before tokens, persistence, and enqueue", async () => {
    const snapshot = sectionBranchingSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm([
      {
        question_id: "q-entity-type",
        question_type: "radio",
        value: "individual",
      },
      {
        question_id: "q-company-name",
        question_type: "short_text",
        value: "Acme Secret",
      },
    ]);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid response data",
    });
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    expect(mocks.addNotificationJob).not.toHaveBeenCalled();
    expect(mocks.addSheetsSyncJob).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain(
      "Acme Secret",
    );
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "POST: response reachability validation failed",
      "forms-public",
      {
        publicId: "public-form-1",
        errors: ["Response 2: Question q-company-name is not reachable"],
      },
    );
  });

  it("accepts reachable branch answers selected by submitted responses", async () => {
    const snapshot = sectionBranchingSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm([
      {
        question_id: "q-entity-type",
        question_type: "radio",
        value: "corporate",
      },
      {
        question_id: "q-company-name",
        question_type: "short_text",
        value: "Acme",
      },
    ]);

    expect(response.status).toBe(201);
    expect(mocks.consumeTokensOrThrow).toHaveBeenCalledWith(
      ["telemetry-token"],
      "203.0.113.10",
    );
    expect(mocks.db.transaction).toHaveBeenCalledOnce();
  });

  it("uses the response field for the submitted question type when computing reachability", async () => {
    const snapshot = checkboxBranchingSnapshot();
    useSuccessfulSubmitSelects(snapshot);
    useTransactionWithInsertCapture();

    const response = await submitPublicForm([
      {
        question_id: "q-plan",
        question_type: "checkbox",
        value: "premium",
        values: ["basic"],
      },
      {
        question_id: "q-premium-note",
        question_type: "short_text",
        value: "crafted premium answer",
      },
    ]);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid response data",
    });
    expect(mocks.consumeTokensOrThrow).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain(
      "crafted premium answer",
    );
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
