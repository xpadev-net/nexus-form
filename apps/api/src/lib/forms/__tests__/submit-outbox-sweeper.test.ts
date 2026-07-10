import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    formResponse: {
      id: "formResponse.id",
      submittedAt: "formResponse.submittedAt",
    },
    formSubmitOutbox: {
      id: "formSubmitOutbox.id",
      responseId: "formSubmitOutbox.responseId",
      formId: "formSubmitOutbox.formId",
      effectType: "formSubmitOutbox.effectType",
      snapshotVersion: "formSubmitOutbox.snapshotVersion",
      integrationId: "formSubmitOutbox.integrationId",
      claimToken: "formSubmitOutbox.claimToken",
      claimExpiresAt: "formSubmitOutbox.claimExpiresAt",
      enqueuedAt: "formSubmitOutbox.enqueuedAt",
      attemptCount: "formSubmitOutbox.attemptCount",
      createdAt: "formSubmitOutbox.createdAt",
    },
  };

  return {
    addNotificationJob: vi.fn(),
    addSheetsJob: vi.fn(),
    captureError: vi.fn(),
    claimBatches: [] as unknown[][],
    db: {
      select: vi.fn(),
      transaction: vi.fn(),
      update: vi.fn(),
    },
    forCalls: [] as unknown[][],
    logError: vi.fn(),
    schema,
    updateSets: [] as unknown[],
  };
});

vi.mock("@nexus-form/database", () => ({ db: mocks.db }));
vi.mock("@nexus-form/database/schema", () => mocks.schema);
vi.mock("../../logger", () => ({ logError: mocks.logError }));
vi.mock("../../queues", () => ({
  getFormSubmitNotificationQueue: vi.fn(() => ({
    add: mocks.addNotificationJob,
  })),
  getSheetsSyncQueue: vi.fn(() => ({ add: mocks.addSheetsJob })),
}));
vi.mock("../../sentry", () => ({ captureError: mocks.captureError }));
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
  lte: vi.fn((left: unknown, right: unknown) => ({
    type: "lte",
    left,
    right,
  })),
  or: vi.fn((...args: unknown[]) => ({ type: "or", args })),
}));

type ClaimedRow = {
  id: string;
  responseId: string;
  formId: string;
  effectType: "NOTIFICATION" | "SHEETS";
  snapshotVersion: number | null;
  integrationId: string | null;
  attemptCount: number;
  submittedAt: Date;
};

function notificationRow(overrides: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    id: "form-submit-notification.form-1.response-1",
    responseId: "response-1",
    formId: "form-1",
    effectType: "NOTIFICATION",
    snapshotVersion: 7,
    integrationId: null,
    attemptCount: 0,
    submittedAt: new Date("2026-07-10T01:02:03.000Z"),
    ...overrides,
  };
}

function sheetsRow(overrides: Partial<ClaimedRow> = {}): ClaimedRow {
  return notificationRow({
    id: "sheets-auto.integration-1.response-1",
    effectType: "SHEETS",
    integrationId: "integration-1",
    ...overrides,
  });
}

function useClaimBatches(batches: ClaimedRow[][]): void {
  mocks.claimBatches = [...batches];
  mocks.db.transaction.mockImplementation(async (callback) => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  for: vi.fn(async (...args: unknown[]) => {
                    mocks.forCalls.push(args);
                    return mocks.claimBatches.shift() ?? [];
                  }),
                })),
              })),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    return callback(tx);
  });
}

function useSuccessfulUpdates(): void {
  mocks.db.update.mockImplementation(() => ({
    set: vi.fn((values: unknown) => {
      mocks.updateSets.push(values);
      return { where: vi.fn(async () => undefined) };
    }),
  }));
}

describe("submit outbox sweeper", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.updateSets.length = 0;
    mocks.forCalls.length = 0;
    mocks.addNotificationJob.mockResolvedValue({ id: "notification-job" });
    mocks.addSheetsJob.mockResolvedValue({ id: "sheets-job" });
    useSuccessfulUpdates();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SUBMIT_OUTBOX_SWEEP_INTERVAL_MS;
  });

  it("enqueues notification and Sheets rows with their stable outbox job IDs", async () => {
    const notification = notificationRow();
    const sheets = sheetsRow();
    useClaimBatches([[notification, sheets]]);
    const { sweepSubmitOutbox } = await import("../submit-outbox-sweeper");

    await expect(sweepSubmitOutbox()).resolves.toEqual({
      scanned: 2,
      enqueued: 2,
      failed: 0,
    });
    expect(mocks.addNotificationJob).toHaveBeenCalledWith(
      "form-submit",
      {
        formId: "form-1",
        responseId: "response-1",
        snapshotVersion: 7,
        submittedAt: "2026-07-10T01:02:03.000Z",
      },
      { jobId: notification.id },
    );
    expect(mocks.addSheetsJob).toHaveBeenCalledWith(
      "auto-sync",
      {
        formId: "form-1",
        integrationId: "integration-1",
        mode: "incremental",
        responseId: "response-1",
        snapshotVersion: 7,
      },
      { jobId: sheets.id },
    );
  });

  it("releases a failed Redis claim and recovers it on a later sweep", async () => {
    const row = notificationRow();
    useClaimBatches([[row], [row]]);
    mocks.addNotificationJob
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValueOnce({ id: "notification-job" });
    const { sweepSubmitOutbox } = await import("../submit-outbox-sweeper");

    await expect(sweepSubmitOutbox()).resolves.toEqual({
      scanned: 1,
      enqueued: 0,
      failed: 1,
    });
    await expect(sweepSubmitOutbox()).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      failed: 0,
    });
    expect(mocks.addNotificationJob).toHaveBeenCalledTimes(2);
    expect(mocks.updateSets[0]).toMatchObject({
      claimToken: null,
      claimExpiresAt: null,
      lastError: "Redis unavailable",
    });
  });

  it("does not enqueue an already terminal row during a repeated sweep", async () => {
    useClaimBatches([[notificationRow()], []]);
    const { sweepSubmitOutbox } = await import("../submit-outbox-sweeper");

    await sweepSubmitOutbox();
    await expect(sweepSubmitOutbox()).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      failed: 0,
    });
    expect(mocks.addNotificationJob).toHaveBeenCalledOnce();
  });

  it("lets only one concurrent replica claim the same candidate", async () => {
    useClaimBatches([[notificationRow()], []]);
    const { sweepSubmitOutbox } = await import("../submit-outbox-sweeper");

    const results = await Promise.all([
      sweepSubmitOutbox(),
      sweepSubmitOutbox(),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        { scanned: 1, enqueued: 1, failed: 0 },
        { scanned: 0, enqueued: 0, failed: 0 },
      ]),
    );
    expect(mocks.forCalls).toEqual([
      ["update", { skipLocked: true }],
      ["update", { skipLocked: true }],
    ]);
    expect(mocks.addNotificationJob).toHaveBeenCalledOnce();
  });

  it("replays the same job ID after queue success but DB acknowledgement failure", async () => {
    const row = notificationRow();
    useClaimBatches([[row], [row]]);
    let updateAttempt = 0;
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(async () => {
            updateAttempt += 1;
            if (updateAttempt === 1) throw new Error("DB ack unavailable");
          }),
        };
      }),
    }));
    const { sweepSubmitOutbox } = await import("../submit-outbox-sweeper");

    await sweepSubmitOutbox();
    await sweepSubmitOutbox({
      now: new Date("2026-07-10T01:03:04.000Z"),
    });

    expect(mocks.addNotificationJob).toHaveBeenCalledTimes(2);
    expect(mocks.addNotificationJob.mock.calls[0]?.[2]).toEqual({
      jobId: row.id,
    });
    expect(mocks.addNotificationJob.mock.calls[1]?.[2]).toEqual({
      jobId: row.id,
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "Failed to acknowledge enqueued submit side effect",
      "api",
      expect.objectContaining({ outboxId: row.id }),
    );
  });

  it("runs immediately on startup and stop waits for the in-flight sweep", async () => {
    vi.useFakeTimers();
    process.env.SUBMIT_OUTBOX_SWEEP_INTERVAL_MS = "25";
    useClaimBatches([[], []]);
    const { createSubmitOutboxSweeper } = await import(
      "../submit-outbox-sweeper"
    );
    const sweeper = createSubmitOutboxSweeper();

    sweeper.start();
    await vi.waitFor(() => expect(mocks.db.transaction).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(25);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(2);
    await expect(sweeper.stop()).resolves.toBeUndefined();
  });

  it("keeps migration 0015 additive and documents migration-first rolling deploy", async () => {
    const migration = await readFile(
      new URL(
        "../../../../../../packages/database/drizzle/0015_amusing_ghost_rider.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("CREATE TABLE `FormSubmitOutbox`");
    expect(migration).not.toMatch(/DROP TABLE|RENAME TABLE|DROP COLUMN/);
    expect(migration).toContain("FormSubmitOutbox_responseId_effectType_key");
    expect(migration).toContain("FormSubmitOutbox_pending_claim_idx");
    expect(migration).toContain("apply this additive migration before");
    expect(migration).toContain("until all old replicas are drained");
  });
});
