import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const queue = {
    add: vi.fn(),
    close: vi.fn(),
    getJob: vi.fn(),
  };

  return {
    db: {
      insert: vi.fn(),
    },
    insertValues: [] as unknown[],
    onDuplicateKeyUpdate: vi.fn(async () => undefined),
    queue,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  formSubmitOutbox: {
    attemptCount: "formSubmitOutbox.attemptCount",
    claimExpiresAt: "formSubmitOutbox.claimExpiresAt",
    claimToken: "formSubmitOutbox.claimToken",
    effectType: "formSubmitOutbox.effectType",
    enqueuedAt: "formSubmitOutbox.enqueuedAt",
    formId: "formSubmitOutbox.formId",
    id: "formSubmitOutbox.id",
    integrationId: "formSubmitOutbox.integrationId",
    lastAttemptAt: "formSubmitOutbox.lastAttemptAt",
    lastError: "formSubmitOutbox.lastError",
    responseId: "formSubmitOutbox.responseId",
    snapshotVersion: "formSubmitOutbox.snapshotVersion",
  },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function QueueMock() {
    return mocks.queue;
  }),
}));

vi.mock("../redis", () => ({
  redisConnection: {},
}));

vi.mock("drizzle-orm", () => ({
  sql: vi.fn((chunks: TemplateStringsArray) => chunks.join("")),
}));

describe("sheets-sync-queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.insertValues.length = 0;
    mocks.queue.add.mockResolvedValue({ id: "queue-job" });
    mocks.queue.getJob.mockResolvedValue(null);
    mocks.db.insert.mockImplementation(() => ({
      values: vi.fn((values: unknown) => {
        mocks.insertValues.push(values);
        return {
          onDuplicateKeyUpdate: mocks.onDuplicateKeyUpdate,
        };
      }),
    }));
  });

  it("enqueues validation refresh jobs with a validation result scoped job id", async () => {
    const { enqueueValidationRefreshSheetsSyncJob } = await import(
      "../sheets-sync-queue"
    );

    await enqueueValidationRefreshSheetsSyncJob({
      formId: "form-1",
      integrationId: "integration-1",
      responseId: "response-1",
      snapshotVersion: 7,
      validationResultId: "validation-result:abcdef1234567890",
    });

    expect(mocks.queue.add).toHaveBeenCalledWith(
      "validation-refresh",
      expect.objectContaining({
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-1",
        snapshotVersion: 7,
        refreshValidationOutputs: true,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^sheets-refresh\./),
      }),
    );
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("persists a durable outbox row when direct enqueue fails", async () => {
    mocks.queue.add.mockRejectedValueOnce(new Error("Redis unavailable"));
    const { enqueueValidationRefreshSheetsSyncJob } = await import(
      "../sheets-sync-queue"
    );

    await enqueueValidationRefreshSheetsSyncJob({
      formId: "form-1",
      integrationId: "integration-1",
      responseId: "response-1",
      snapshotVersion: 7,
      validationResultId: "validation-result:abcdef1234567890",
    });

    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    expect(mocks.onDuplicateKeyUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^sheets-refresh\./),
        effectType: expect.stringMatching(/^SHEETS_REFRESH_/),
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-1",
        snapshotVersion: 7,
      }),
    );
    expect(mocks.queue.add).toHaveBeenCalledWith(
      "validation-refresh",
      expect.objectContaining({ refreshValidationOutputs: true }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^sheets-refresh\./),
      }),
    );
  });
});
