import type { DefaultJobOptions } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueues,
  getFormSubmitNotificationQueue,
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

  it("limits retained form submit notification jobs by default", () => {
    getFormSubmitNotificationQueue();

    expect(mocks.queueInstances[0]?.options.defaultJobOptions).toMatchObject({
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    expect(
      mocks.queueInstances[0]?.options.defaultJobOptions,
    ).not.toHaveProperty("attempts");
    expect(
      mocks.queueInstances[0]?.options.defaultJobOptions,
    ).not.toHaveProperty("backoff");
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
