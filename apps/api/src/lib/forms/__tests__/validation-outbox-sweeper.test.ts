import { buildValidationOutboxJobId } from "@nexus-form/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      id: "externalServiceValidationResult.id",
      responseId: "externalServiceValidationResult.responseId",
      ruleId: "externalServiceValidationResult.ruleId",
      referencedBlockId: "externalServiceValidationResult.referencedBlockId",
      service: "externalServiceValidationResult.service",
      snapshotVersion: "externalServiceValidationResult.snapshotVersion",
      status: "externalServiceValidationResult.status",
      jobId: "externalServiceValidationResult.jobId",
      createdAt: "externalServiceValidationResult.createdAt",
      claimToken: "externalServiceValidationResult.claimToken",
      claimExpiresAt: "externalServiceValidationResult.claimExpiresAt",
      enqueueAttemptCount:
        "externalServiceValidationResult.enqueueAttemptCount",
      nextEligibleAt: "externalServiceValidationResult.nextEligibleAt",
      enqueueMode: "externalServiceValidationResult.enqueueMode",
    },
    formResponse: {
      id: "formResponse.id",
      formId: "formResponse.formId",
    },
    formValidationRule: {
      id: "formValidationRule.id",
      ruleType: "formValidationRule.ruleType",
      configJson: "formValidationRule.configJson",
    },
  };

  return {
    addValidationJob: vi.fn(),
    db: {
      select: vi.fn(),
      transaction: vi.fn(),
      update: vi.fn(),
    },
    getLatestSnapshotByVersion: vi.fn(),
    getSnapshotByVersion: vi.fn(),
    providerRegistryGet: vi.fn(),
    schema,
    sequence: [] as string[],
    selectWheres: [] as unknown[],
    updateSets: [] as unknown[],
    updateWheres: [] as unknown[],
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: mocks.providerRegistryGet,
  },
}));

vi.mock("../snapshot-repository", () => ({
  getLatestSnapshotByVersion: mocks.getLatestSnapshotByVersion,
  getSnapshotByVersion: mocks.getSnapshotByVersion,
}));

vi.mock("../../logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../../queues", () => ({
  getValidationQueue: vi.fn(() => ({
    add: mocks.addValidationJob,
  })),
  isValidServiceName: vi.fn((serviceName: string) =>
    /^[a-z][a-z0-9_]*$/.test(serviceName),
  ),
}));

vi.mock("../../sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  asc: vi.fn((value: unknown) => ({ type: "asc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ type: "gt", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    type: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
  or: vi.fn((...args: unknown[]) => ({ type: "or", args })),
  sql: vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => ({
    type: "sql",
    strings: Array.from(strings),
    params,
  })),
}));

type PendingRow = {
  id: string;
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  service: string | null;
  formId: string;
  snapshotVersion: number | null;
  liveRuleType: string | null;
  liveConfigJson: unknown;
  enqueueAttemptCount: number;
  enqueueMode: "LEGACY" | "STABLE";
};

function pendingRow(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: "validation-result-1",
    responseId: "response-1",
    ruleId: "rule-1",
    referencedBlockId: "block-1",
    service: "discord",
    formId: "form-1",
    snapshotVersion: 7,
    liveRuleType: "guild_member",
    liveConfigJson: { guildId: "guild-1" },
    enqueueAttemptCount: 0,
    enqueueMode: "STABLE",
    ...overrides,
  };
}

function usePendingRows(rows: PendingRow[]) {
  usePendingRowsResult(Promise.resolve(rows));
}

function usePendingRowsResult(rows: Promise<PendingRow[]>) {
  const forUpdate = vi.fn(async () =>
    (await rows).filter((row) => row.enqueueMode === "STABLE"),
  );
  const limit = vi.fn(() => ({ for: forUpdate }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn((condition: unknown) => {
    mocks.selectWheres.push(condition);
    return { orderBy };
  });
  const leftJoin = vi.fn(() => ({ where }));
  const innerJoin = vi.fn(() => ({ leftJoin }));
  const from = vi.fn(() => ({ innerJoin }));
  mocks.db.select.mockReturnValue({ from });
  mocks.db.transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) =>
      callback({ select: mocks.db.select, update: mocks.db.update }),
  );
}

function useClaimRowsSequence(rowsByClaim: PendingRow[][]) {
  let claimIndex = 0;
  mocks.db.transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) => {
      const rows = rowsByClaim[claimIndex++] ?? [];
      const forUpdate = vi.fn(async () => rows);
      const limit = vi.fn(() => ({ for: forUpdate }));
      const orderBy = vi.fn(() => ({ limit }));
      const where = vi.fn((condition: unknown) => {
        mocks.selectWheres.push(condition);
        return { orderBy };
      });
      const leftJoin = vi.fn(() => ({ where }));
      const innerJoin = vi.fn(() => ({ leftJoin }));
      const from = vi.fn(() => ({ innerJoin }));
      const select = vi.fn(() => ({ from }));
      return callback({ select, update: mocks.db.update });
    },
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

type MockSqlExpression = {
  type: "sql";
  strings: string[];
  params: unknown[];
};

function isMockSqlExpression(value: unknown): value is MockSqlExpression {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "sql" &&
    Array.isArray(record.strings) &&
    record.strings.every((part) => typeof part === "string") &&
    Array.isArray(record.params)
  );
}

function findSqlExpressions(value: unknown): MockSqlExpression[] {
  if (isMockSqlExpression(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(findSqlExpressions);
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(findSqlExpressions);
}

function hasSqlExpression(
  value: unknown,
  expectedText: string,
  expectedParams?: unknown[],
): boolean {
  return findSqlExpressions(value).some(
    (expression) =>
      expression.strings.join("?") === expectedText &&
      (expectedParams === undefined ||
        JSON.stringify(expression.params) === JSON.stringify(expectedParams)),
  );
}

function useUpdateResults(results: Array<{ affectedRows: number }>) {
  mocks.db.update.mockImplementation(() => ({
    set: vi.fn((values: unknown) => {
      mocks.updateSets.push(values);
      return {
        where: vi.fn(async (where: unknown) => {
          mocks.updateWheres.push(where);
          mocks.sequence.push("db:update");
          return [results.shift() ?? { affectedRows: 1 }];
        }),
      };
    }),
  }));
}

type RuntimeValidationOutboxRow = PendingRow & {
  status: "PENDING" | "FAILED";
  jobId: string | null;
  createdAt: Date;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  nextEligibleAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function runtimeValidationOutboxRow(
  overrides: Partial<RuntimeValidationOutboxRow> = {},
): RuntimeValidationOutboxRow {
  return {
    ...pendingRow({ snapshotVersion: null, enqueueAttemptCount: 1 }),
    status: "PENDING",
    jobId: null,
    createdAt: new Date("2026-07-10T23:59:00.000Z"),
    claimToken: null,
    claimExpiresAt: null,
    nextEligibleAt: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evaluateSqlExpression(value: unknown, now: Date): unknown {
  if (!isMockSqlExpression(value)) return value;
  const sqlText = value.strings.join("?");
  if (sqlText === "CURRENT_TIMESTAMP") return now;
  if (sqlText === "TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP)") {
    const [seconds] = value.params;
    if (typeof seconds === "number") {
      return new Date(now.getTime() + seconds * 1_000);
    }
  }
  return value;
}

function readRuntimeOperand(
  row: RuntimeValidationOutboxRow,
  operand: unknown,
  now: Date,
): unknown {
  switch (operand) {
    case mocks.schema.externalServiceValidationResult.id:
      return row.id;
    case mocks.schema.externalServiceValidationResult.status:
      return row.status;
    case mocks.schema.externalServiceValidationResult.enqueueMode:
      return row.enqueueMode;
    case mocks.schema.externalServiceValidationResult.jobId:
      return row.jobId;
    case mocks.schema.externalServiceValidationResult.createdAt:
      return row.createdAt;
    case mocks.schema.externalServiceValidationResult.claimToken:
      return row.claimToken;
    case mocks.schema.externalServiceValidationResult.claimExpiresAt:
      return row.claimExpiresAt;
    case mocks.schema.externalServiceValidationResult.enqueueAttemptCount:
      return row.enqueueAttemptCount;
    case mocks.schema.externalServiceValidationResult.nextEligibleAt:
      return row.nextEligibleAt;
    default:
      return evaluateSqlExpression(operand, now);
  }
}

function compareRuntimeValues(
  left: unknown,
  right: unknown,
  compare: (leftValue: number, rightValue: number) => boolean,
): boolean {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  return (
    typeof leftValue === "number" &&
    typeof rightValue === "number" &&
    compare(leftValue, rightValue)
  );
}

function matchesRuntimePredicate(
  row: RuntimeValidationOutboxRow,
  predicate: unknown,
  now: Date,
): boolean {
  if (!isRecord(predicate) || typeof predicate.type !== "string") {
    return false;
  }
  if (predicate.type === "and") {
    return (
      Array.isArray(predicate.args) &&
      predicate.args.every((entry) => matchesRuntimePredicate(row, entry, now))
    );
  }
  if (predicate.type === "or") {
    return (
      Array.isArray(predicate.args) &&
      predicate.args.some((entry) => matchesRuntimePredicate(row, entry, now))
    );
  }
  if (predicate.type === "eq") {
    return (
      readRuntimeOperand(row, predicate.left, now) ===
      readRuntimeOperand(row, predicate.right, now)
    );
  }
  if (predicate.type === "isNull") {
    return readRuntimeOperand(row, predicate.value, now) === null;
  }
  if (predicate.type === "inArray") {
    const left = readRuntimeOperand(row, predicate.left, now);
    return Array.isArray(predicate.right) && predicate.right.includes(left);
  }
  if (predicate.type === "lte") {
    return compareRuntimeValues(
      readRuntimeOperand(row, predicate.left, now),
      readRuntimeOperand(row, predicate.right, now),
      (left, right) => left <= right,
    );
  }
  if (predicate.type === "gt") {
    return compareRuntimeValues(
      readRuntimeOperand(row, predicate.left, now),
      readRuntimeOperand(row, predicate.right, now),
      (left, right) => left > right,
    );
  }
  return false;
}

function applyRuntimeSet(
  row: RuntimeValidationOutboxRow,
  values: unknown,
  now: Date,
): void {
  if (!isRecord(values)) return;

  if (values.status === "PENDING" || values.status === "FAILED") {
    row.status = values.status;
  }
  if (typeof values.jobId === "string" || values.jobId === null) {
    row.jobId = values.jobId;
  }
  if (typeof values.enqueueAttemptCount === "number") {
    row.enqueueAttemptCount = values.enqueueAttemptCount;
  }
  if (typeof values.claimToken === "string" || values.claimToken === null) {
    row.claimToken = values.claimToken;
  }
  if (values.claimExpiresAt === null) {
    row.claimExpiresAt = null;
  } else if (values.claimExpiresAt !== undefined) {
    const claimExpiresAt = evaluateSqlExpression(values.claimExpiresAt, now);
    if (claimExpiresAt instanceof Date) row.claimExpiresAt = claimExpiresAt;
  }
  if (values.nextEligibleAt === null) {
    row.nextEligibleAt = null;
  } else if (values.nextEligibleAt !== undefined) {
    const nextEligibleAt = evaluateSqlExpression(values.nextEligibleAt, now);
    if (nextEligibleAt instanceof Date) row.nextEligibleAt = nextEligibleAt;
  }
  if (typeof values.errorCode === "string" || values.errorCode === null) {
    row.errorCode = values.errorCode;
  }
  if (typeof values.errorMessage === "string" || values.errorMessage === null) {
    row.errorMessage = values.errorMessage;
  }
}

function toPendingRow(row: RuntimeValidationOutboxRow): PendingRow {
  return {
    id: row.id,
    responseId: row.responseId,
    ruleId: row.ruleId,
    referencedBlockId: row.referencedBlockId,
    service: row.service,
    formId: row.formId,
    snapshotVersion: row.snapshotVersion,
    liveRuleType: row.liveRuleType,
    liveConfigJson: row.liveConfigJson,
    enqueueAttemptCount: row.enqueueAttemptCount,
    enqueueMode: row.enqueueMode,
  };
}

function useStatefulValidationOutbox(
  row: RuntimeValidationOutboxRow,
  options: {
    getDatabaseNow: () => Date;
    failJobIdAcknowledgementOnce?: boolean;
  },
): void {
  let failJobIdAcknowledgement = options.failJobIdAcknowledgementOnce === true;

  const update = vi.fn(() => ({
    set: vi.fn((values: unknown) => {
      mocks.updateSets.push(values);
      return {
        where: vi.fn(async (where: unknown) => {
          mocks.updateWheres.push(where);
          mocks.sequence.push("db:update");
          const databaseNow = options.getDatabaseNow();
          if (!matchesRuntimePredicate(row, where, databaseNow)) {
            return [{ affectedRows: 0 }];
          }
          if (
            failJobIdAcknowledgement &&
            isRecord(values) &&
            typeof values.jobId === "string"
          ) {
            failJobIdAcknowledgement = false;
            throw new Error("ack lost");
          }

          applyRuntimeSet(row, values, databaseNow);
          return [{ affectedRows: 1 }];
        }),
      };
    }),
  }));
  mocks.db.update.mockImplementation(update);

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn((where: unknown) => {
            mocks.selectWheres.push(where);
            return {
              orderBy: vi.fn(() => ({
                limit: vi.fn((limit: number) => ({
                  for: vi.fn(async () => {
                    const databaseNow = options.getDatabaseNow();
                    return matchesRuntimePredicate(row, where, databaseNow) &&
                      limit > 0
                      ? [toPendingRow(row)]
                      : [];
                  }),
                })),
              })),
            };
          }),
        })),
      })),
    })),
  }));
  mocks.db.select.mockImplementation(select);

  const transactionClient = {
    select: mocks.db.select,
    update: mocks.db.update,
  };
  let transactionTail = Promise.resolve();
  mocks.db.transaction.mockImplementation(
    (callback: (tx: unknown) => unknown) => {
      const run = transactionTail.then(() => callback(transactionClient));
      transactionTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  );
}

describe("validation outbox sweeper", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sequence.length = 0;
    mocks.selectWheres.length = 0;
    mocks.updateSets.length = 0;
    mocks.updateWheres.length = 0;
    mocks.providerRegistryGet.mockReturnValue({
      rules: { guild_member: {} },
    });
    mocks.addValidationJob.mockImplementation(async () => {
      mocks.sequence.push("queue:add");
      return { id: "validation-outbox-uuid-1" };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.VALIDATION_OUTBOX_SWEEP_BATCH_SIZE;
    delete process.env.VALIDATION_OUTBOX_SWEEP_STALE_MS;
    delete process.env.VALIDATION_OUTBOX_SWEEP_INTERVAL_MS;
  });

  it("enqueues with a stable jobId before persisting job ownership", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const now = new Date("2026-07-11T00:00:00.000Z");
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      leaseMs: 1_501,
      now,
      random: () => 0.5,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.sequence).toEqual([
      "db:update",
      "db:update",
      "queue:add",
      "db:update",
    ]);
    expect(mocks.updateSets[0]).toMatchObject({
      claimToken: expect.any(String),
      claimExpiresAt: expect.objectContaining({
        type: "sql",
        strings: ["TIMESTAMPADD(SECOND, ", ", CURRENT_TIMESTAMP)"],
        params: [2],
      }),
    });
    expect(mocks.updateSets[1]).toMatchObject({
      claimExpiresAt: expect.objectContaining({
        type: "sql",
        strings: ["TIMESTAMPADD(SECOND, ", ", CURRENT_TIMESTAMP)"],
        params: [2],
      }),
    });
    expect(hasSqlExpression(mocks.selectWheres[0], "CURRENT_TIMESTAMP")).toBe(
      true,
    );
    expect(
      hasSqlExpression(
        mocks.selectWheres[0],
        "TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP)",
        [0],
      ),
    ).toBe(true);
    expect(hasSqlExpression(mocks.updateWheres[0], "CURRENT_TIMESTAMP")).toBe(
      true,
    );
    expect(hasSqlExpression(mocks.updateWheres[1], "CURRENT_TIMESTAMP")).toBe(
      true,
    );
    expect(mocks.updateSets[2]).toMatchObject({
      jobId: "validation-outbox-validation-result-1",
      errorCode: null,
      errorMessage: null,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      {
        responseId: "response-1",
        ruleId: "rule-1",
        referencedBlockId: "block-1",
        snapshotProviderName: "discord",
        snapshotRuleType: "guild_member",
        snapshotConfigJson: { guildId: "guild-1" },
        snapshotVersion: undefined,
      },
      { jobId: "validation-outbox-validation-result-1" },
    );
    const { buildValidationOutboxJobId } = await import("@nexus-form/shared");
    expect(mocks.addValidationJob.mock.calls[0]?.[2]).toEqual({
      jobId: buildValidationOutboxJobId("validation-result-1"),
    });
  });

  it("prefers the response snapshot over changed live validation rule config", async () => {
    usePendingRows([
      pendingRow({
        liveRuleType: "guild_member",
        liveConfigJson: { guildId: "changed-live-guild" },
      }),
    ]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);
    mocks.getSnapshotByVersion.mockResolvedValue({
      validationRulesJson: JSON.stringify([
        {
          id: "rule-1",
          name: "Discord membership",
          providerName: "discord",
          ruleType: "guild_member",
          referencedBlockIds: ["block-1"],
          configJson: { guildId: "snapshot-guild" },
          orderIndex: 0,
        },
      ]),
      structureJson: JSON.stringify({
        version: 1,
        settings: { allow_edit_responses: false },
      }),
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const now = new Date("2026-07-11T00:00:00.000Z");
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now,
      random: () => 0.5,
    });

    expect(result.enqueued).toBe(1);
    expect(mocks.getSnapshotByVersion).toHaveBeenCalledWith("form-1", 7);
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        snapshotRuleType: "guild_member",
        snapshotConfigJson: { guildId: "snapshot-guild" },
      }),
      { jobId: "validation-outbox-validation-result-1" },
    );
  });

  it("leaves LEGACY rows untouched", async () => {
    usePendingRows([pendingRow({ enqueueMode: "LEGACY" })]);

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("uses server time for the stale boundary despite API clock skew", async () => {
    usePendingRows([]);
    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );

    await sweepValidationOutbox({
      staleMs: 1_501,
      now: new Date("2026-07-11T00:00:00.000Z"),
      clock: () => new Date("2026-07-11T00:00:00.000Z"),
    });
    await sweepValidationOutbox({
      staleMs: 0,
      now: new Date("2026-07-11T00:20:00.000Z"),
      clock: () => new Date("2026-07-11T00:20:00.000Z"),
    });

    expect(
      hasSqlExpression(
        mocks.selectWheres[0],
        "TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP)",
        [-2],
      ),
    ).toBe(true);
    expect(
      hasSqlExpression(
        mocks.selectWheres[1],
        "TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP)",
        [0],
      ),
    ).toBe(true);
    expect(
      findSqlExpressions(mocks.selectWheres[0]).every(({ params }) =>
        params.every((param) => !(param instanceof Date)),
      ),
    ).toBe(true);
  });

  it("recovers the fail-once direct enqueue through the periodic sweeper with the shared attempt count", async () => {
    let databaseNow = new Date("2026-07-11T00:00:00.000Z");
    const row = runtimeValidationOutboxRow({ enqueueAttemptCount: 1 });
    useStatefulValidationOutbox(row, {
      getDatabaseNow: () => databaseNow,
    });

    const { createValidationOutboxSweeper } = await import(
      "../validation-outbox-sweeper"
    );
    const sweeper = createValidationOutboxSweeper();

    await expect(sweeper.runOnce()).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });

    const expectedJobId = buildValidationOutboxJobId(row.id);
    expect(row).toMatchObject({
      status: "PENDING",
      enqueueMode: "STABLE",
      enqueueAttemptCount: 2,
      jobId: expectedJobId,
      claimToken: null,
      claimExpiresAt: null,
      nextEligibleAt: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({ responseId: "response-1", ruleId: "rule-1" }),
      { jobId: expectedJobId },
    );

    databaseNow = new Date("2026-07-11T00:10:00.000Z");
    await expect(sweeper.runOnce()).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);
  });

  it("applies backoff through attempts two to seven and fails on the shared eighth attempt", async () => {
    let databaseNow = new Date("2026-07-11T00:00:00.000Z");
    const row = runtimeValidationOutboxRow({ enqueueAttemptCount: 1 });
    useStatefulValidationOutbox(row, {
      getDatabaseNow: () => databaseNow,
    });
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const scheduledDelays: number[] = [];

    for (let expectedAttempt = 2; expectedAttempt <= 8; expectedAttempt += 1) {
      const attemptStartedAt = databaseNow;
      const result = await sweepValidationOutbox({
        staleMs: 0,
        batchSize: 1,
        random: () => 0,
      });

      expect(row.enqueueAttemptCount).toBe(expectedAttempt);
      if (expectedAttempt < 8) {
        expect(result).toEqual({
          scanned: 1,
          enqueued: 0,
          failed: 0,
          retryScheduled: 1,
        });
        const nextEligibleAt = row.nextEligibleAt;
        if (!(nextEligibleAt instanceof Date)) {
          throw new Error("Retry did not persist nextEligibleAt");
        }
        scheduledDelays.push(
          (nextEligibleAt.getTime() - attemptStartedAt.getTime()) / 1_000,
        );
        databaseNow = nextEligibleAt;
      } else {
        expect(result).toEqual({
          scanned: 1,
          enqueued: 0,
          failed: 1,
          retryScheduled: 0,
        });
      }
    }

    expect(scheduledDelays).toEqual([60, 120, 240, 480, 870, 870]);
    expect(row).toMatchObject({
      status: "FAILED",
      enqueueMode: "STABLE",
      enqueueAttemptCount: 8,
      jobId: null,
      claimToken: null,
      claimExpiresAt: null,
      nextEligibleAt: null,
      errorCode: "ENQUEUE_RETRY_EXHAUSTED",
      errorMessage: "Validation job enqueue retry limit exceeded",
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(7);
  });

  it("lets concurrent sweepers create only one effective stable job", async () => {
    const databaseNow = new Date("2026-07-11T00:00:00.000Z");
    const row = runtimeValidationOutboxRow({ enqueueAttemptCount: 1 });
    useStatefulValidationOutbox(row, {
      getDatabaseNow: () => databaseNow,
    });
    const queueAdd = createDeferred<{ id: string }>();
    mocks.addValidationJob.mockReturnValue(queueAdd.promise);

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const first = sweepValidationOutbox({
      staleMs: 0,
      batchSize: 1,
      leaseMs: 60_000,
    });
    await vi.waitFor(() => expect(mocks.addValidationJob).toHaveBeenCalled());

    await expect(
      sweepValidationOutbox({
        staleMs: 0,
        batchSize: 1,
        leaseMs: 60_000,
      }),
    ).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });

    const expectedJobId = buildValidationOutboxJobId(row.id);
    queueAdd.resolve({ id: expectedJobId });
    await expect(first).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);
    expect(mocks.addValidationJob.mock.calls[0]?.[2]).toEqual({
      jobId: expectedJobId,
    });
    expect(row).toMatchObject({
      enqueueAttemptCount: 2,
      jobId: expectedJobId,
      claimToken: null,
      claimExpiresAt: null,
    });
  });

  it("recovers queue-success acknowledgement uncertainty with one effective job and the same Worker fence id", async () => {
    let databaseNow = new Date("2026-07-11T00:00:00.000Z");
    const row = runtimeValidationOutboxRow({ enqueueAttemptCount: 1 });
    useStatefulValidationOutbox(row, {
      getDatabaseNow: () => databaseNow,
      failJobIdAcknowledgementOnce: true,
    });
    const effectiveJobIds = new Set<string>();
    mocks.addValidationJob.mockImplementation(
      async (_name: string, _data: unknown, options: { jobId?: string }) => {
        const jobId = options.jobId ?? "";
        effectiveJobIds.add(jobId);
        return { id: jobId };
      },
    );

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    await expect(
      sweepValidationOutbox({ staleMs: 0, batchSize: 1, leaseMs: 1_000 }),
    ).resolves.toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });

    expect(row.jobId).toBeNull();
    expect(row.enqueueAttemptCount).toBe(1);
    const firstClaimExpiry = row.claimExpiresAt;
    if (!(firstClaimExpiry instanceof Date)) {
      throw new Error("Acknowledgement uncertainty did not retain its lease");
    }
    databaseNow = new Date(firstClaimExpiry.getTime() + 1);

    await expect(
      sweepValidationOutbox({ staleMs: 0, batchSize: 1, leaseMs: 1_000 }),
    ).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });

    const expectedJobId = buildValidationOutboxJobId(row.id);
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(2);
    expect(mocks.addValidationJob.mock.calls.map((call) => call[2])).toEqual([
      { jobId: expectedJobId },
      { jobId: expectedJobId },
    ]);
    expect(effectiveJobIds).toEqual(new Set([expectedJobId]));
    expect(row).toMatchObject({
      status: "PENDING",
      enqueueAttemptCount: 2,
      jobId: expectedJobId,
      claimToken: null,
      claimExpiresAt: null,
      nextEligibleAt: null,
    });
  });

  it("schedules a retry when enqueue fails", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);
    mocks.addValidationJob.mockImplementation(async () => {
      mocks.sequence.push("queue:add");
      throw new Error("redis down");
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const now = new Date("2026-07-11T00:00:00.000Z");
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now,
      random: () => 0.5,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 1,
    });
    expect(mocks.updateSets[2]).toMatchObject({
      errorCode: "ENQUEUE_FAILED",
      errorMessage: "redis down",
      enqueueAttemptCount: 1,
      nextEligibleAt: expect.objectContaining({
        type: "sql",
        strings: ["TIMESTAMPADD(SECOND, ", ", CURRENT_TIMESTAMP)"],
        params: [45],
      }),
      claimToken: null,
      claimExpiresAt: null,
    });
    expect(mocks.updateWheres[2]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining([
          expect.objectContaining({
            type: "isNull",
            value: mocks.schema.externalServiceValidationResult.jobId,
          }),
        ]),
      }),
    );
  });

  it("schedules retry backoff from the failure time", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([]);
    const startedAt = new Date("2026-07-11T00:00:00.000Z");
    let currentNow = startedAt;
    mocks.addValidationJob.mockImplementation(async () => {
      currentNow = new Date("2026-07-11T00:00:05.000Z");
      throw new Error("redis down");
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: startedAt,
      clock: () => currentNow,
      random: () => 0,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 1,
    });
    expect(mocks.updateSets[2]).toMatchObject({
      nextEligibleAt: expect.objectContaining({
        type: "sql",
        strings: ["TIMESTAMPADD(SECOND, ", ", CURRENT_TIMESTAMP)"],
        params: [30],
      }),
    });
    expect(
      hasSqlExpression(
        mocks.updateSets[2],
        "TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP)",
        [30],
      ),
    ).toBe(true);
  });

  it("keeps retry writes on DB time across fast and slow API clocks", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([]);
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const fastApiClock = () => new Date("2026-07-11T00:00:05.000Z");
    const slowApiClock = () => new Date("2026-07-10T23:55:00.000Z");

    await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: fastApiClock(),
      clock: fastApiClock,
      random: () => 0,
    });
    await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: slowApiClock(),
      clock: slowApiClock,
      random: () => 0,
    });

    const retryWrites = mocks.updateSets.filter(
      (value): value is { nextEligibleAt: unknown } =>
        typeof value === "object" &&
        value !== null &&
        "nextEligibleAt" in value,
    );
    expect(retryWrites).toHaveLength(2);
    expect(
      retryWrites.every(({ nextEligibleAt }) =>
        hasSqlExpression(
          nextEligibleAt,
          "TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP)",
          [30],
        ),
      ),
    ).toBe(true);
    expect(
      retryWrites.every(
        ({ nextEligibleAt }) => !(nextEligibleAt instanceof Date),
      ),
    ).toBe(true);
  });

  it("does not count a retry when the claim CAS no longer matches", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 0 }]);
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: new Date("2026-07-11T00:00:00.000Z"),
      random: () => 0.5,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
  });

  it("does not count a retry when scheduling persistence fails", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    let updateCount = 0;
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async (where: unknown) => {
            mocks.updateWheres.push(where);
            updateCount += 1;
            if (updateCount === 3) throw new Error("db down");
            return [{ affectedRows: 1 }];
          }),
        };
      }),
    }));
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: new Date("2026-07-11T00:00:00.000Z"),
      random: () => 0.5,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
  });

  it("doubles backoff and caps it at fifteen minutes", async () => {
    usePendingRows([
      pendingRow({
        id: "validation-result-2",
        snapshotVersion: null,
        enqueueAttemptCount: 1,
      }),
      pendingRow({
        id: "validation-result-6",
        snapshotVersion: null,
        enqueueAttemptCount: 5,
      }),
    ]);
    useUpdateResults([
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 1 },
    ]);
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const now = new Date("2026-07-11T00:00:00.000Z");
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now,
      random: () => 0.5,
    });

    expect(result).toEqual({
      scanned: 2,
      enqueued: 0,
      failed: 0,
      retryScheduled: 2,
    });
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enqueueAttemptCount: 2,
          nextEligibleAt: expect.objectContaining({
            type: "sql",
            strings: ["TIMESTAMPADD(SECOND, ", ", CURRENT_TIMESTAMP)"],
            params: [75],
          }),
        }),
      ]),
    );
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enqueueAttemptCount: 6,
          nextEligibleAt: expect.objectContaining({
            type: "sql",
            strings: ["TIMESTAMPADD(SECOND, ", ", CURRENT_TIMESTAMP)"],
            params: [885],
          }),
        }),
      ]),
    );
  });

  it("keeps jitter when the retry backoff is already capped", async () => {
    usePendingRows([
      pendingRow({
        id: "validation-result-cap-1",
        snapshotVersion: null,
        enqueueAttemptCount: 6,
      }),
      pendingRow({
        id: "validation-result-cap-2",
        snapshotVersion: null,
        enqueueAttemptCount: 6,
      }),
    ]);
    useUpdateResults([]);
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));
    const randomValues = [0, 1];

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const now = new Date("2026-07-11T00:00:00.000Z");
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now,
      random: () => randomValues.shift() ?? 0,
    });

    expect(result).toEqual({
      scanned: 2,
      enqueued: 0,
      failed: 0,
      retryScheduled: 2,
    });
    const scheduledDelays = mocks.updateSets.flatMap((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("nextEligibleAt" in value) ||
        !isMockSqlExpression(value.nextEligibleAt)
      ) {
        return [];
      }
      const [delay] = value.nextEligibleAt.params;
      return typeof delay === "number" ? [delay] : [];
    });
    expect(scheduledDelays).toEqual([870, 900]);
    expect(scheduledDelays[1]).toBeGreaterThan(scheduledDelays[0] ?? 0);
    expect(scheduledDelays.every((delay) => delay <= 900)).toBe(true);
  });

  it("moves the row to FAILED on the eighth enqueue failure", async () => {
    usePendingRows([
      pendingRow({ snapshotVersion: null, enqueueAttemptCount: 7 }),
    ]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: new Date("2026-07-11T00:00:00.000Z"),
      random: () => 0,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 1,
      retryScheduled: 0,
    });
    expect(mocks.updateSets[2]).toMatchObject({
      status: "FAILED",
      errorCode: "ENQUEUE_RETRY_EXHAUSTED",
      enqueueAttemptCount: 8,
      nextEligibleAt: null,
      claimToken: null,
      claimExpiresAt: null,
    });
  });

  it("does not count terminal failure when the claim CAS no longer matches", async () => {
    usePendingRows([
      pendingRow({ snapshotVersion: null, enqueueAttemptCount: 7 }),
    ]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 0 }]);
    mocks.addValidationJob.mockRejectedValue(new Error("redis down"));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: new Date("2026-07-11T00:00:00.000Z"),
      random: () => 0,
    });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
  });

  it("skips a stale claimant before enqueue after reclaim and job eviction", async () => {
    const firstSnapshot = createDeferred<{
      validationRulesJson: string;
    }>();
    const snapshot = {
      validationRulesJson: JSON.stringify([
        {
          id: "rule-1",
          name: "Discord membership",
          providerName: "discord",
          ruleType: "guild_member",
          referencedBlockIds: ["block-1"],
          configJson: { guildId: "guild-1" },
          orderIndex: 0,
        },
      ]),
    };
    useClaimRowsSequence([[pendingRow()], [pendingRow()]]);
    mocks.getSnapshotByVersion
      .mockImplementationOnce(() => firstSnapshot.promise)
      .mockResolvedValueOnce(snapshot);

    let updateCount = 0;
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async (where: unknown) => {
            mocks.updateWheres.push(where);
            updateCount += 1;
            return [{ affectedRows: updateCount === 5 ? 0 : 1 }];
          }),
        };
      }),
    }));

    const activeJobIds = new Set<string>();
    let providerRuns = 0;
    mocks.addValidationJob.mockImplementation(
      async (_name: string, _data: unknown, options: { jobId?: string }) => {
        const jobId = options.jobId ?? "";
        providerRuns += 1;
        activeJobIds.add(jobId);
        activeJobIds.delete(jobId);
        return { id: jobId };
      },
    );

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    let currentNow = new Date("2026-07-11T00:00:00.000Z");
    const clock = () => currentNow;
    const first = sweepValidationOutbox({
      staleMs: 0,
      batchSize: 1,
      leaseMs: 1_000,
      clock,
    });
    await vi.waitFor(() =>
      expect(mocks.getSnapshotByVersion).toHaveBeenCalledTimes(1),
    );

    currentNow = new Date("2026-07-11T00:00:02.000Z");
    await expect(
      sweepValidationOutbox({
        staleMs: 0,
        batchSize: 1,
        leaseMs: 1_000,
        clock,
      }),
    ).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });

    expect(providerRuns).toBe(1);
    expect(activeJobIds).toEqual(new Set());
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);

    firstSnapshot.resolve(snapshot);
    await expect(first).resolves.toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);
    expect(mocks.updateSets[0]).not.toEqual(mocks.updateSets[1]);
  });

  it("keeps a late reclaimed job harmless through the durable Worker fence", async () => {
    const row = pendingRow({ snapshotVersion: null });
    useClaimRowsSequence([[row], [row]]);

    let updateCount = 0;
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async (where: unknown) => {
            mocks.updateWheres.push(where);
            updateCount += 1;
            return [{ affectedRows: updateCount <= 4 ? 1 : 0 }];
          }),
        };
      }),
    }));

    const stableJobId = "validation-outbox-validation-result-1";
    const workerRow = {
      enqueueMode: "STABLE" as const,
      status: "PENDING" as "PENDING" | "PROCESSING" | "COMPLETED",
      jobId: null as string | null,
    };
    const queuedJobIds = new Set<string>();
    const firstQueueAdd = createDeferred<void>();
    let queueAddCount = 0;
    let providerRuns = 0;
    let lateAdmissionRejected = false;

    const admitStableJob = (jobId: string) => {
      if (workerRow.enqueueMode !== "STABLE") return false;
      if (
        workerRow.status !== "PENDING" &&
        !(workerRow.status === "PROCESSING" && workerRow.jobId === jobId)
      ) {
        return false;
      }
      if (workerRow.jobId !== null && workerRow.jobId !== jobId) return false;

      workerRow.status = "PROCESSING";
      workerRow.jobId = jobId;
      providerRuns += 1;
      workerRow.status = "COMPLETED";
      return true;
    };

    mocks.addValidationJob.mockImplementation(
      async (_name: string, _data: unknown, options: { jobId?: string }) => {
        const jobId = options.jobId ?? "";
        queueAddCount += 1;
        queuedJobIds.add(jobId);

        if (queueAddCount === 1) {
          await firstQueueAdd.promise;
          lateAdmissionRejected = !admitStableJob(jobId);
        } else {
          expect(admitStableJob(jobId)).toBe(true);
        }

        queuedJobIds.delete(jobId);
        return { id: stableJobId };
      },
    );

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    let currentNow = new Date("2026-07-11T00:00:00.000Z");
    const clock = () => currentNow;
    const first = sweepValidationOutbox({
      staleMs: 0,
      batchSize: 1,
      leaseMs: 1_000,
      clock,
    });
    await vi.waitFor(() =>
      expect(mocks.addValidationJob).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateSets).toHaveLength(2);

    currentNow = new Date("2026-07-11T00:00:02.000Z");
    await expect(
      sweepValidationOutbox({
        staleMs: 0,
        batchSize: 1,
        leaseMs: 1_000,
        clock,
      }),
    ).resolves.toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.selectWheres).toHaveLength(2);
    expect(
      mocks.selectWheres.every((where) =>
        hasSqlExpression(where, "CURRENT_TIMESTAMP"),
      ),
    ).toBe(true);

    firstQueueAdd.resolve();
    await expect(first).resolves.toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });

    expect(queueAddCount).toBe(2);
    expect(providerRuns).toBe(1);
    expect(lateAdmissionRejected).toBe(true);
    expect(workerRow.status).toBe("COMPLETED");
    expect(queuedJobIds).toEqual(new Set());
  });

  it("does not duplicate a row while another transaction holds its claim", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);
    const queueAdded = createDeferred<{ id: string }>();
    mocks.addValidationJob.mockReturnValue(queueAdded.promise);
    mocks.db.transaction
      .mockImplementationOnce(async (callback: (tx: unknown) => unknown) =>
        callback({ select: mocks.db.select, update: mocks.db.update }),
      )
      .mockResolvedValueOnce([]);

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const first = sweepValidationOutbox({ staleMs: 0, batchSize: 10 });
    await vi.waitFor(() => expect(mocks.addValidationJob).toHaveBeenCalled());
    const second = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(second).toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);

    queueAdded.resolve({ id: "validation-outbox-validation-result-1" });
    await expect(first).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });
  });

  it("does not mark the row failed when jobId persistence fails after enqueue", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    let updateCount = 0;
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async (where: unknown) => {
            mocks.updateWheres.push(where);
            mocks.sequence.push("db:update");
            updateCount += 1;
            if (updateCount === 3) throw new Error("db down");
            return [{ affectedRows: 1 }];
          }),
        };
      }),
    }));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.sequence).toEqual([
      "db:update",
      "db:update",
      "queue:add",
      "db:update",
    ]);
    expect(mocks.updateSets).toHaveLength(3);
    expect(mocks.updateSets[2]).toMatchObject({
      jobId: "validation-outbox-validation-result-1",
    });
  });

  it("does not count enqueue when jobId persistence loses its CAS", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 0 },
    ]);

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(1);
  });

  it("recovers an ack uncertainty after lease expiry with the same jobId", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    let updateCount = 0;
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async (where: unknown) => {
            mocks.updateWheres.push(where);
            updateCount += 1;
            if (updateCount === 3) throw new Error("ack lost");
            return [{ affectedRows: 1 }];
          }),
        };
      }),
    }));

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const first = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: new Date("2026-07-11T00:00:00.000Z"),
      leaseMs: 1_000,
    });
    const second = await sweepValidationOutbox({
      staleMs: 0,
      batchSize: 10,
      now: new Date("2026-07-11T00:00:02.000Z"),
      leaseMs: 1_000,
    });

    expect(first).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(second).toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).toHaveBeenCalledTimes(2);
    expect(mocks.addValidationJob.mock.calls[0]?.[2]).toEqual({
      jobId: "validation-outbox-validation-result-1",
    });
    expect(mocks.addValidationJob.mock.calls[1]?.[2]).toEqual({
      jobId: "validation-outbox-validation-result-1",
    });
    expect(mocks.updateSets[5]).toMatchObject({
      jobId: "validation-outbox-validation-result-1",
      claimToken: null,
      claimExpiresAt: null,
    });
  });

  it("does not fall back to live config when a versioned snapshot entry is missing", async () => {
    usePendingRows([
      pendingRow({
        liveRuleType: "guild_member",
        liveConfigJson: { guildId: "changed-live-guild" },
      }),
    ]);
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);
    mocks.getSnapshotByVersion.mockResolvedValue({
      validationRulesJson: "[]",
      structureJson: JSON.stringify({
        version: 1,
        settings: { allow_edit_responses: false },
      }),
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 1,
      retryScheduled: 0,
    });
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    expect(mocks.updateSets[1]).toMatchObject({
      status: "FAILED",
      errorCode: "RULE_CONFIG_NOT_FOUND",
      errorMessage:
        "Validation rule configuration was not found in response snapshot",
    });
  });

  it("shares the same runOnce promise while a sweep is in flight", async () => {
    const pendingRows = createDeferred<PendingRow[]>();
    usePendingRowsResult(pendingRows.promise);

    const { createValidationOutboxSweeper } = await import(
      "../validation-outbox-sweeper"
    );
    const sweeper = createValidationOutboxSweeper();
    const first = sweeper.runOnce();
    const second = sweeper.runOnce();

    expect(second).toBe(first);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);

    pendingRows.resolve([]);
    await expect(first).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
  });

  it("waits for an in-flight sweep when stop is called", async () => {
    const pendingRows = createDeferred<PendingRow[]>();
    usePendingRowsResult(pendingRows.promise);

    const { createValidationOutboxSweeper } = await import(
      "../validation-outbox-sweeper"
    );
    const sweeper = createValidationOutboxSweeper();
    const run = sweeper.runOnce();
    let stopped = false;
    const stop = sweeper.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    pendingRows.resolve([]);
    await stop;
    await expect(run).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(stopped).toBe(true);
  });

  it("swallows an in-flight sweep rejection when stop is called", async () => {
    const pendingRows = createDeferred<PendingRow[]>();
    usePendingRowsResult(pendingRows.promise);

    const { createValidationOutboxSweeper } = await import(
      "../validation-outbox-sweeper"
    );
    const sweeper = createValidationOutboxSweeper();
    const run = sweeper.runOnce();
    const runExpectation = expect(run).rejects.toThrow("db down");
    const stop = sweeper.stop();

    pendingRows.reject(new Error("db down"));

    await expect(stop).resolves.toBeUndefined();
    await runExpectation;
  });

  it("starts one interval and schedules recurring sweeps", async () => {
    vi.useFakeTimers();
    process.env.VALIDATION_OUTBOX_SWEEP_INTERVAL_MS = "25";
    usePendingRows([]);
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    const { createValidationOutboxSweeper } = await import(
      "../validation-outbox-sweeper"
    );
    const sweeper = createValidationOutboxSweeper();

    sweeper.start();
    sweeper.start();
    await Promise.resolve();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(mocks.db.select).toHaveBeenCalledTimes(2);

    await sweeper.stop();
  });
});
