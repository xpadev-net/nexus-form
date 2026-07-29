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
  getJob: ReturnType<typeof vi.fn>;
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
      getJob: vi.fn(async () => null),
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

  it("uses a stable jobId per form for response link analysis jobs", async () => {
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
      { delay: 10_000, jobId: "response-link-analysis.form-1" },
    );
    expect(queue?.add).toHaveBeenNthCalledWith(
      2,
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1" },
    );
  });

  it("uses response-link analysis retry defaults", () => {
    getResponseLinkAnalysisQueue();

    expect(mocks.queueInstances[0]?.options.defaultJobOptions).toMatchObject({
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 60_000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  });

  it("coalesces active response link analysis changes into one follow-up job", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    queue?.getJob.mockImplementation(async (jobId: string) =>
      jobId === "response-link-analysis.form-1"
        ? {
            getState: vi.fn(async () => "active"),
            remove: vi.fn(async () => undefined),
          }
        : null,
    );

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(queue?.add).toHaveBeenCalledTimes(1);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1.follow-up" },
    );
  });

  it("extends an existing follow-up response link analysis job before starting another primary job", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    const changeDelay = vi.fn(async () => undefined);
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === "response-link-analysis.form-1") {
        return {
          getState: vi.fn(async () => "completed"),
          remove: vi.fn(async () => undefined),
        };
      }
      if (jobId === "response-link-analysis.form-1.follow-up") {
        return {
          changeDelay,
          getState: vi.fn(async () => "delayed"),
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(changeDelay).toHaveBeenCalledWith(10_000);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1.follow-up" },
    );
  });

  it("adds a replacement when delayed response link changeDelay loses its state race", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    const changeDelay = vi.fn(async () => {
      throw new Error("Job is not in the delayed state");
    });
    const getState = vi
      .fn()
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("waiting");
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === "response-link-analysis.form-1") {
        return {
          getState: vi.fn(async () => "completed"),
          remove: vi.fn(async () => undefined),
        };
      }
      if (jobId === "response-link-analysis.form-1.follow-up") {
        return {
          changeDelay,
          getState,
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(changeDelay).toHaveBeenCalledWith(10_000);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1" },
    );
  });

  it("adds a follow-up replacement when primary delayed changeDelay loses its state race", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    const changeDelay = vi.fn(async () => {
      throw new Error("Job is not in the delayed state");
    });
    const getState = vi
      .fn()
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("waiting");
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === "response-link-analysis.form-1") {
        return {
          changeDelay,
          getState,
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(changeDelay).toHaveBeenCalledWith(10_000);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1.follow-up" },
    );
  });

  it("uses an overflow response link analysis job when primary and follow-up are both active", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (
        jobId === "response-link-analysis.form-1" ||
        jobId === "response-link-analysis.form-1.follow-up"
      ) {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(queue?.add).toHaveBeenCalledTimes(1);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.overflow",
      },
    );
  });

  it("queues a primary response link analysis job when the follow-up job is already active", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === "response-link-analysis.form-1") {
        return {
          getState: vi.fn(async () => "completed"),
          remove: vi.fn(async () => undefined),
        };
      }
      if (jobId === "response-link-analysis.form-1.follow-up") {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1" },
    );
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
