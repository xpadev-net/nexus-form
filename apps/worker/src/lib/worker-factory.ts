import { type Processor, Worker, type WorkerOptions } from "bullmq";
import { redisConnection } from "./redis";

export const createWorker = <T>(
  queueName: string,
  processor: Processor<T, unknown, string>,
  options?: Omit<WorkerOptions, "connection">,
) => {
  return new Worker<T, unknown, string>(queueName, processor, {
    connection: redisConnection,
    concurrency: 5,
    ...(options ?? {}),
  });
};
