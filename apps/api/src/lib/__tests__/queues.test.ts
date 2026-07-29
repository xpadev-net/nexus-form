import type { DefaultJobOptions } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueues,
  enqueueResponseLinkAnalysisJob,
  getFormSubmitNotificationQueue,
  getResponseLinkAnalysisQueue,
  getSheetsSyncQueue,
  getValidationQueue,
  SHEETS_SYNC_MANUAL_RETRY_JOB_OPTIONS,
} from "../queues";

type QueueOptions = {
  connection: unknown;
  defaultJobOptions?: DefaultJobOptions;
};

type MockQueue = {
  name: string;
  options: QueueOptions;
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const queueInstances: MockQueue[] = [];
  const Queue = vi.fn(function queueMock(
    name: string,
    options: QueueOptions,
  ): MockQueue {
    const queue = {
      name,
      options,
      add: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    queueInstances.push(queue);
    return queue;
  });

  return {
    Queue,
    queueInstances,
    getRedisConnection: vi.fn(() => ({ connection: { id: "redis" } })),
  };
});

vi.mock("bullmq", () => ({
  Queue: mocks.Queue,
}));

vi.mock("../redis", () => ({
  getRedisConnection: mocks.getRedisConnection,
}));

describe("queues", () => {
  beforeEach(async () => {
    await closeQueues();
    mocks.Queue.mockClear();
    mocks.getRedisConnection.mockClear();
    mocks.queueInstances.length = 0;
  });

  it("limits retained validation jobs by default", () => {
    getValidationQueue("discord");

    expect(mocks.queueInstances[0]?.options.defaultJobOptions).toMatchObject({
      attempts: 3,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  });

  it("limits retained sheets sync jobs by default", () => {
    getSheetsSyncQueue();

    expect(mocks.queueInstances[0]?.options.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  });

  it("retries and limits retained form submit notification jobs by default", () => {
    getFormSubmitNotificationQueue();

    expect(mocks.queueInstances[0]?.options.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  });

  it("uses unique response link analysis job ids so active jobs do not drop follow-up analysis", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-submitted",
    });
    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(queue?.add).toHaveBeenCalledTimes(2);
    expect(queue?.add).toHaveBeenNthCalledWith(
      1,
      "response-submitted",
      { formId: "form-1", reason: "response-submitted" },
      { jobId: expect.stringMatching(/^response-link-analysis\.form-1\./) },
    );
    expect(queue?.add).toHaveBeenNthCalledWith(
      2,
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { jobId: expect.stringMatching(/^response-link-analysis\.form-1\./) },
    );
    const firstJobId = queue?.add.mock.calls[0]?.[2]?.jobId;
    const secondJobId = queue?.add.mock.calls[1]?.[2]?.jobId;
    expect(firstJobId).not.toBe(secondJobId);
  });

  it("exposes retry options for manual sheets sync jobs", () => {
    expect(SHEETS_SYNC_MANUAL_RETRY_JOB_OPTIONS).toMatchObject({
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
    });
  });
});
