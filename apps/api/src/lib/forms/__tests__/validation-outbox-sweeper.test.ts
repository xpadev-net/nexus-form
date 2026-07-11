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
  inArray: vi.fn((left: unknown, right: unknown) => ({
    type: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
  or: vi.fn((...args: unknown[]) => ({ type: "or", args })),
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
  const where = vi.fn(() => ({ orderBy }));
  const leftJoin = vi.fn(() => ({ where }));
  const innerJoin = vi.fn(() => ({ leftJoin }));
  const from = vi.fn(() => ({ innerJoin }));
  mocks.db.select.mockReturnValue({ from });
  mocks.db.transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) =>
      callback({ select: mocks.db.select, update: mocks.db.update }),
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

function useUpdateResults(results: Array<{ affectedRows: number }>) {
  mocks.db.update.mockImplementation(() => ({
    set: vi.fn((values: unknown) => {
      mocks.updateSets.push(values);
      return {
        where: vi.fn(async (where: unknown) => {
          mocks.updateWheres.push(where);
          mocks.sequence.push("db:update");
          return [results.shift() ?? { affectedRows: 0 }];
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
    useUpdateResults([{ affectedRows: 1 }]);

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
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.sequence).toEqual(["db:update", "queue:add", "db:update"]);
    expect(mocks.updateSets[0]).toMatchObject({
      claimToken: expect.any(String),
      claimExpiresAt: expect.any(Date),
    });
    expect(mocks.updateSets[1]).toMatchObject({
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
  });

  it("prefers the response snapshot over changed live validation rule config", async () => {
    usePendingRows([
      pendingRow({
        liveRuleType: "guild_member",
        liveConfigJson: { guildId: "changed-live-guild" },
      }),
    ]);
    useUpdateResults([{ affectedRows: 1 }]);
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

  it("schedules a retry when enqueue fails", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([{ affectedRows: 1 }]);
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
    expect(mocks.updateSets[1]).toMatchObject({
      errorCode: "ENQUEUE_FAILED",
      errorMessage: "redis down",
      enqueueAttemptCount: 1,
      nextEligibleAt: new Date("2026-07-11T00:00:45.000Z"),
      claimToken: null,
      claimExpiresAt: null,
    });
    expect(mocks.updateWheres[1]).toEqual(
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
    expect(mocks.updateSets[1]).toMatchObject({
      enqueueAttemptCount: 2,
      nextEligibleAt: new Date("2026-07-11T00:01:15.000Z"),
    });
    expect(mocks.updateSets[2]).toMatchObject({
      enqueueAttemptCount: 6,
      nextEligibleAt: new Date("2026-07-11T00:15:00.000Z"),
    });
  });

  it("moves the row to FAILED on the eighth enqueue failure", async () => {
    usePendingRows([
      pendingRow({ snapshotVersion: null, enqueueAttemptCount: 7 }),
    ]);
    useUpdateResults([{ affectedRows: 1 }]);
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
    expect(mocks.updateSets[1]).toMatchObject({
      status: "FAILED",
      errorCode: "ENQUEUE_RETRY_EXHAUSTED",
      enqueueAttemptCount: 8,
      nextEligibleAt: null,
      claimToken: null,
      claimExpiresAt: null,
    });
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
            if (updateCount === 2) throw new Error("db down");
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
      enqueued: 1,
      failed: 0,
      retryScheduled: 0,
    });
    expect(mocks.sequence).toEqual(["db:update", "queue:add", "db:update"]);
    expect(mocks.updateSets).toHaveLength(2);
    expect(mocks.updateSets[1]).toMatchObject({
      jobId: "validation-outbox-validation-result-1",
    });
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
            if (updateCount === 2) throw new Error("ack lost");
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
      enqueued: 1,
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
    expect(mocks.updateSets[3]).toMatchObject({
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
    useUpdateResults([{ affectedRows: 1 }]);
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
