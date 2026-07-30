import type { DefaultJobOptions } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    redisDisconnect: vi.fn(),
    redisQuit: vi.fn(async () => "OK"),
    redisSet: vi.fn(async () => "OK"),
  };
});

vi.mock("bullmq", () => ({
  Queue: mocks.Queue,
}));

vi.mock("ioredis", () => ({
  default: vi.fn(function redisMock() {
    return {
      disconnect: mocks.redisDisconnect,
      quit: mocks.redisQuit,
      set: mocks.redisSet,
    };
  }),
}));

vi.mock("../redis", () => ({
  getRedisConnection: mocks.getRedisConnection,
}));

describe("queues", () => {
  beforeEach(async () => {
    await closeQueues();
    mocks.Queue.mockClear();
    mocks.getRedisConnection.mockClear();
    mocks.redisDisconnect.mockClear();
    mocks.redisQuit.mockClear();
    mocks.redisSet.mockClear();
    mocks.queueInstances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
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

    const firstResult = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-submitted",
    });
    const secondResult = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(firstResult).toEqual({ enqueued: true, status: "enqueued" });
    expect(secondResult).toEqual({ enqueued: true, status: "enqueued" });
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

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: true, status: "enqueued" });
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

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: false, status: "coalesced" });
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

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: true, status: "enqueued" });
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

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: true, status: "enqueued" });
    expect(changeDelay).toHaveBeenCalledWith(10_000);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1.follow-up" },
    );
  });

  it("uses overflow when follow-up activation races after primary is active", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    const changeDelay = vi.fn(async () => {
      throw new Error("Job is not in the delayed state");
    });
    const followUpGetState = vi
      .fn()
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("active");
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === "response-link-analysis.form-1") {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      if (jobId === "response-link-analysis.form-1.follow-up") {
        return {
          changeDelay,
          getState: followUpGetState,
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: true, status: "enqueued" });
    expect(changeDelay).toHaveBeenCalledWith(10_000);
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.follow-up",
      },
    );
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      { delay: 10_000, jobId: "response-link-analysis.form-1.overflow" },
    );
  });

  it("marks dirty when follow-up activation races and overflow is already active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:05.000Z"));
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    const changeDelay = vi.fn(async () => {
      throw new Error("Job is not in the delayed state");
    });
    const followUpGetState = vi
      .fn()
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("active");
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === "response-link-analysis.form-1") {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      if (jobId === "response-link-analysis.form-1.follow-up") {
        return {
          changeDelay,
          getState: followUpGetState,
          remove: vi.fn(async () => undefined),
        };
      }
      if (jobId === "response-link-analysis.form-1.overflow") {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: false, status: "dirty" });
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
      expect.any(String),
      "EX",
      86_400,
    );
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.dirty.178528321",
      },
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

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: true, status: "enqueued" });
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

  it("marks response-link analysis dirty and schedules a coalesced dirty job when every stable analysis slot is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:05.000Z"));
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (
        jobId === "response-link-analysis.form-1" ||
        jobId === "response-link-analysis.form-1.follow-up" ||
        jobId === "response-link-analysis.form-1.overflow"
      ) {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: false, status: "dirty" });
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
      expect.any(String),
      "EX",
      86_400,
    );
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.dirty.178528321",
      },
    );
  });

  it("marks response-link analysis dirty when overflow delay refresh loses its state race", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:05.000Z"));
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    const overflowChangeDelay = vi.fn(async () => {
      throw new Error("Job is not in the delayed state");
    });
    const overflowGetState = vi
      .fn()
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("active");
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
      if (jobId === "response-link-analysis.form-1.overflow") {
        return {
          changeDelay: overflowChangeDelay,
          getState: overflowGetState,
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: false, status: "dirty" });
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
      expect.any(String),
      "EX",
      86_400,
    );
    expect(queue?.add).toHaveBeenCalledWith(
      "response-deleted",
      { formId: "form-1", reason: "response-deleted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.dirty.178528321",
      },
    );
  });

  it("leaves a dirty marker when dirty rescue enqueue fails", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    queue?.add.mockRejectedValueOnce(new Error("queue unavailable"));
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (
        jobId === "response-link-analysis.form-1" ||
        jobId === "response-link-analysis.form-1.follow-up" ||
        jobId === "response-link-analysis.form-1.overflow"
      ) {
        return {
          getState: vi.fn(async () => "active"),
          remove: vi.fn(async () => undefined),
        };
      }
      return null;
    });

    await expect(
      enqueueResponseLinkAnalysisJob({
        formId: "form-1",
        reason: "response-deleted",
      }),
    ).rejects.toThrow("queue unavailable");

    expect(mocks.redisSet).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
      expect.any(String),
      "EX",
      86_400,
    );
  });

  it("quits the response-link analysis dirty client on close", async () => {
    getResponseLinkAnalysisQueue();
    const queue = mocks.queueInstances[0];
    queue?.getJob.mockImplementation(async (jobId: string) => {
      if (
        jobId === "response-link-analysis.form-1" ||
        jobId === "response-link-analysis.form-1.follow-up" ||
        jobId === "response-link-analysis.form-1.overflow"
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
    await closeQueues();

    expect(mocks.redisQuit).toHaveBeenCalledTimes(1);
    expect(mocks.redisDisconnect).not.toHaveBeenCalled();
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

    const result = await enqueueResponseLinkAnalysisJob({
      formId: "form-1",
      reason: "response-deleted",
    });

    expect(result).toEqual({ enqueued: true, status: "enqueued" });
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
