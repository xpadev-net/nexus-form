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
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
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
    ...overrides,
  };
}

function usePendingRows(rows: PendingRow[]) {
  usePendingRowsResult(Promise.resolve(rows));
}

function usePendingRowsResult(rows: Promise<PendingRow[]>) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const leftJoin = vi.fn(() => ({ where }));
  const innerJoin = vi.fn(() => ({ leftJoin }));
  const from = vi.fn(() => ({ innerJoin }));
  mocks.db.select.mockReturnValue({ from });
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
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
    });
    expect(mocks.sequence).toEqual(["queue:add", "db:update"]);
    expect(mocks.updateSets[0]).toMatchObject({
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
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

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

  it("marks the row FAILED when enqueue fails", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    useUpdateResults([{ affectedRows: 1 }]);
    mocks.addValidationJob.mockImplementation(async () => {
      mocks.sequence.push("queue:add");
      throw new Error("redis down");
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 1,
    });
    expect(mocks.updateSets[0]).toMatchObject({
      status: "FAILED",
      errorCode: "ENQUEUE_FAILED",
      errorMessage: "Failed to enqueue validation job",
    });
    expect(mocks.updateWheres[0]).toEqual(
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

  it("does not mark the row failed when jobId persistence fails after enqueue", async () => {
    usePendingRows([pendingRow({ snapshotVersion: null })]);
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async (where: unknown) => {
            mocks.updateWheres.push(where);
            mocks.sequence.push("db:update");
            throw new Error("db down");
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
    });
    expect(mocks.sequence).toEqual(["queue:add", "db:update"]);
    expect(mocks.updateSets).toHaveLength(1);
    expect(mocks.updateSets[0]).toMatchObject({
      jobId: "validation-outbox-validation-result-1",
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
    });

    const { sweepValidationOutbox } = await import(
      "../validation-outbox-sweeper"
    );
    const result = await sweepValidationOutbox({ staleMs: 0, batchSize: 10 });

    expect(result).toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 1,
    });
    expect(mocks.addValidationJob).not.toHaveBeenCalled();
    expect(mocks.updateSets[0]).toMatchObject({
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
