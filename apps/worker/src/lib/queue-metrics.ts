/**
 * キューメトリクス収集・異常検知
 * BullMQ キューの状態を監視し、異常を検知する
 */
import { providerRegistry } from "@nexus-form/integrations";
import { Queue } from "bullmq";
import { redisConnection } from "./redis";

const COMPLETED_SAMPLE_SIZE = Number(
  process.env.QUEUE_METRICS_SAMPLE_SIZE ?? "500",
);

export interface QueueMetrics {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  avgProcessingTime?: number;
}

const STATIC_QUEUE_NAMES = ["google-sheets-sync"] as const;

function collectQueueNames(): string[] {
  const validationQueues = providerRegistry
    .getNames()
    .map((name) => `${name}-validation`);
  return [...validationQueues, ...STATIC_QUEUE_NAMES];
}

const queueCache = new Map<string, Queue>();

function getOrCreateQueue(name: string): Queue {
  let queue = queueCache.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: redisConnection });
    queueCache.set(name, queue);
  }
  return queue;
}

// 前回のメトリクスを保存
const previousMetrics = new Map<
  string,
  { completed: number; failed: number }
>();

// 異常検知の閾値
const DELTA_FAILED_THRESHOLD = 50;
const DELTA_FAILED_RATIO_THRESHOLD = 0.3;
const WAITING_THRESHOLD = 1000;

export async function collectQueueMetrics(): Promise<QueueMetrics[]> {
  const metrics: QueueMetrics[] = [];

  for (const name of collectQueueNames()) {
    const queue = getOrCreateQueue(name);

    try {
      const [waiting, active, completed, failed, delayed, isPaused] =
        await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
          queue.isPaused(),
        ]);

      let avgProcessingTime: number | undefined;
      try {
        const completedJobs = await queue.getCompleted(
          0,
          COMPLETED_SAMPLE_SIZE - 1,
        );
        if (completedJobs.length > 0) {
          const totalTime = completedJobs.reduce((sum, job) => {
            const processedOn = job.processedOn ?? 0;
            const finishedOn = job.finishedOn ?? 0;
            return sum + (finishedOn - processedOn);
          }, 0);
          avgProcessingTime = totalTime / completedJobs.length;
        }
      } catch {
        avgProcessingTime = undefined;
      }

      metrics.push({
        name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused,
        avgProcessingTime,
      });
    } catch {
      // Skip metric for this queue on error; logged by the caller
    }
  }

  return metrics;
}

export function detectAnomalies(
  metrics: QueueMetrics[],
): Array<{ queue: string; type: string; detail: string }> {
  const anomalies: Array<{ queue: string; type: string; detail: string }> = [];

  for (const metric of metrics) {
    // 待機数チェック
    if (metric.waiting > WAITING_THRESHOLD) {
      anomalies.push({
        queue: metric.name,
        type: "high_backlog",
        detail: `Waiting count: ${metric.waiting} (threshold: ${WAITING_THRESHOLD})`,
      });
    }

    // 前回のデータがある場合のみ差分チェック
    const prev = previousMetrics.get(metric.name);
    if (prev) {
      const deltaCompleted = metric.completed - prev.completed;
      const deltaFailed = metric.failed - prev.failed;
      const deltaTotal = deltaCompleted + deltaFailed;
      const deltaFailedRatio = deltaTotal > 0 ? deltaFailed / deltaTotal : 0;

      if (
        deltaFailed > DELTA_FAILED_THRESHOLD ||
        (deltaTotal > 10 && deltaFailedRatio > DELTA_FAILED_RATIO_THRESHOLD)
      ) {
        anomalies.push({
          queue: metric.name,
          type: "high_failure_rate",
          detail: `Delta failed: ${deltaFailed}, ratio: ${(deltaFailedRatio * 100).toFixed(1)}%`,
        });
      }
    }

    previousMetrics.set(metric.name, {
      completed: metric.completed,
      failed: metric.failed,
    });
  }

  return anomalies;
}

export function startQueueMetricsCollection(): ReturnType<
  typeof setInterval
> | null {
  const intervalValue = process.env.QUEUE_METRICS_INTERVAL ?? "60000";
  const interval = Number.parseInt(intervalValue, 10);

  if (Number.isNaN(interval) || interval <= 0) {
    console.log(
      "[queue-metrics] Invalid QUEUE_METRICS_INTERVAL, metrics collection disabled",
    );
    return null;
  }

  console.log(
    `[queue-metrics] Starting queue metrics collection (interval: ${interval}ms)`,
  );

  return setInterval(async () => {
    try {
      const metrics = await collectQueueMetrics();

      for (const m of metrics) {
        console.log(
          `[queue-metrics] ${m.name}: waiting=${m.waiting} active=${m.active} completed=${m.completed} failed=${m.failed} delayed=${m.delayed}`,
        );
      }

      const anomalies = detectAnomalies(metrics);
      for (const a of anomalies) {
        console.warn(
          `[queue-metrics] ANOMALY ${a.queue}: ${a.type} - ${a.detail}`,
        );
      }
    } catch (error) {
      console.error("[queue-metrics] Failed to collect metrics:", error);
    }
  }, interval);
}
