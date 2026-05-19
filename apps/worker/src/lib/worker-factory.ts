import { type Processor, Worker, type WorkerOptions } from "bullmq";
import { parsePositiveIntEnv } from "./env";
import { redisConnection } from "./redis";

const DEFAULT_WORKER_CONCURRENCY = 5;

export function getWorkerConcurrencyEnvName(queueName: string): string {
  // Queue names are currently unique after this normalization. If a future
  // queue differs only by separator characters, it will intentionally share the
  // same override key and should be renamed or handled with a dedicated option.
  const queueKey = queueName.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  return `WORKER_CONCURRENCY_${queueKey}`;
}

export function getWorkerConcurrency(queueName: string): number {
  const defaultConcurrency = parsePositiveIntEnv(
    "WORKER_CONCURRENCY",
    DEFAULT_WORKER_CONCURRENCY,
  );
  return parsePositiveIntEnv(
    getWorkerConcurrencyEnvName(queueName),
    defaultConcurrency,
  );
}

export const createWorker = <T>(
  queueName: string,
  processor: Processor<T, unknown, string>,
  options?: Omit<WorkerOptions, "connection">,
) => {
  return new Worker<T, unknown, string>(queueName, processor, {
    connection: redisConnection,
    concurrency: getWorkerConcurrency(queueName),
    ...(options ?? {}),
  });
};
