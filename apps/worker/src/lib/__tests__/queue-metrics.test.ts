import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../load-env", () => ({}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    getNames: vi.fn().mockReturnValue([]),
  },
}));

function createQueueMock() {
  return {
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getActiveCount: vi.fn().mockResolvedValue(0),
    getCompletedCount: vi.fn().mockResolvedValue(0),
    getFailedCount: vi.fn().mockResolvedValue(0),
    getDelayedCount: vi.fn().mockResolvedValue(0),
    isPaused: vi.fn().mockResolvedValue(false),
    getCompleted: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(createQueueMock),
}));

vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn(),
    quit: vi.fn(),
  }));
  return { default: RedisMock, Redis: RedisMock };
});

import { providerRegistry } from "@nexus-form/integrations";
import { Queue } from "bullmq";
import {
  closeMetricsQueues,
  collectQueueMetrics,
  detectAnomalies,
  type QueueMetrics,
  resetQueueMetricsStateForTests,
} from "../queue-metrics";

function makeMetric(overrides: Partial<QueueMetrics> = {}): QueueMetrics {
  return {
    name: "test-queue",
    waiting: 0,
    active: 0,
    completed: 100,
    failed: 0,
    delayed: 0,
    paused: false,
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

afterEach(async () => {
  await closeMetricsQueues();
  resetQueueMetricsStateForTests();
  vi.mocked(providerRegistry.getNames).mockReturnValue([]);
  vi.mocked(Queue).mockClear();
});

describe("detectAnomalies (T-WORKER-TEST: queue-metrics anomaly detection)", () => {
  it("returns no anomalies for healthy metrics", () => {
    const metrics = [makeMetric()];
    const result = detectAnomalies(metrics);
    expect(result).toHaveLength(0);
  });

  it("detects high_backlog when waiting exceeds threshold", () => {
    const metrics = [makeMetric({ waiting: 1001 })];
    const result = detectAnomalies(metrics);
    const backlog = result.filter((a) => a.type === "high_backlog");
    expect(backlog).toHaveLength(1);
    expect(backlog[0]?.queue).toBe("test-queue");
  });

  it("does not flag high_backlog at exactly the threshold", () => {
    const metrics = [makeMetric({ waiting: 1000 })];
    const result = detectAnomalies(metrics);
    expect(result.filter((a) => a.type === "high_backlog")).toHaveLength(0);
  });

  it("detects high_failure_rate when delta failed exceeds absolute threshold", () => {
    // First call: set baseline
    detectAnomalies([makeMetric({ name: "q-abs", completed: 100, failed: 0 })]);

    // Second call: 51 new failures → exceeds DELTA_FAILED_THRESHOLD (50)
    const result = detectAnomalies([
      makeMetric({ name: "q-abs", completed: 100, failed: 51 }),
    ]);

    const rateAnomaly = result.filter((a) => a.type === "high_failure_rate");
    expect(rateAnomaly).toHaveLength(1);
    expect(rateAnomaly[0]?.queue).toBe("q-abs");
  });

  it("detects high_failure_rate when failure ratio exceeds ratio threshold", () => {
    // First call: set baseline
    detectAnomalies([
      makeMetric({ name: "q-ratio", completed: 100, failed: 0 }),
    ]);

    // Second call: 11 new total, 4 failed → ratio ≈ 36% > 30% threshold; deltaFailed < 50
    const result = detectAnomalies([
      makeMetric({ name: "q-ratio", completed: 107, failed: 4 }),
    ]);

    const rateAnomaly = result.filter((a) => a.type === "high_failure_rate");
    expect(rateAnomaly).toHaveLength(1);
    expect(rateAnomaly[0]?.queue).toBe("q-ratio");
  });

  it("does not detect high_failure_rate on the first call (no baseline)", () => {
    const result = detectAnomalies([
      makeMetric({ name: "q-fresh", completed: 50, failed: 30 }),
    ]);
    expect(result.filter((a) => a.type === "high_failure_rate")).toHaveLength(
      0,
    );
  });

  it("does not flag high_failure_rate when delta total <= 10", () => {
    // baseline
    detectAnomalies([
      makeMetric({ name: "q-small", completed: 100, failed: 0 }),
    ]);
    // only 9 new total, 4 failed → ratio high but delta total ≤ 10 and deltaFailed < 50
    const result = detectAnomalies([
      makeMetric({ name: "q-small", completed: 105, failed: 4 }),
    ]);
    expect(result.filter((a) => a.type === "high_failure_rate")).toHaveLength(
      0,
    );
  });

  it("reports anomalies for multiple queues independently", () => {
    const metrics = [
      makeMetric({ name: "q-backlog", waiting: 2000 }),
      makeMetric({ name: "q-healthy", waiting: 0 }),
    ];
    const result = detectAnomalies(metrics);
    const backlogQueues = result
      .filter((a) => a.type === "high_backlog")
      .map((a) => a.queue);
    expect(backlogQueues).toContain("q-backlog");
    expect(backlogQueues).not.toContain("q-healthy");
  });
});

describe("closeMetricsQueues", () => {
  it("waits for in-flight collection and prevents new queues during shutdown", async () => {
    vi.mocked(providerRegistry.getNames).mockReturnValue(["first", "second"]);
    const waitingCount = createDeferred<number>();
    const firstQueue = createQueueMock();
    firstQueue.getWaitingCount.mockReturnValue(waitingCount.promise);
    vi.mocked(Queue).mockImplementationOnce(
      () => firstQueue as unknown as InstanceType<typeof Queue>,
    );

    const metricsPromise = collectQueueMetrics();
    await vi.waitFor(() => {
      expect(Queue).toHaveBeenCalledTimes(1);
    });

    const closePromise = closeMetricsQueues();
    waitingCount.resolve(0);

    await Promise.all([metricsPromise, closePromise]);

    expect(Queue).toHaveBeenCalledTimes(1);
    expect(firstQueue.close).toHaveBeenCalledTimes(1);
  });
});
