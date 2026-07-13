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
