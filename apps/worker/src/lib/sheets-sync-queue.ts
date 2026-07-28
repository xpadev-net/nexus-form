import {
  buildAutoSheetsSyncJobId,
  sheetsSyncJobDataSchema,
} from "@nexus-form/shared";
import { type DefaultJobOptions, Queue } from "bullmq";
import { redisConnection } from "./redis";

const JOB_RETENTION_DEFAULTS = {
  removeOnComplete: 100,
  removeOnFail: 100,
} satisfies Pick<DefaultJobOptions, "removeOnComplete" | "removeOnFail">;

const SHEETS_SYNC_JOB_DEFAULTS: DefaultJobOptions = {
  ...JOB_RETENTION_DEFAULTS,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30_000,
  },
};

let sheetsSyncQueue: Queue | null = null;

export function getSheetsSyncQueue(): Queue {
  if (!sheetsSyncQueue) {
    sheetsSyncQueue = new Queue("google-sheets-sync", {
      connection: redisConnection,
      defaultJobOptions: SHEETS_SYNC_JOB_DEFAULTS,
    });
  }
  return sheetsSyncQueue;
}

export async function closeSheetsSyncQueue(): Promise<void> {
  if (!sheetsSyncQueue) return;
  try {
    await sheetsSyncQueue.close();
  } finally {
    sheetsSyncQueue = null;
  }
}

export async function enqueueValidationRefreshSheetsSyncJob(params: {
  formId: string;
  integrationId: string;
  responseId: string;
  snapshotVersion?: number;
}): Promise<void> {
  const queue = getSheetsSyncQueue();
  const jobId = `${buildAutoSheetsSyncJobId(
    params.integrationId,
    params.responseId,
  )}.validation-refresh`;
  const existingJob = await queue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "failed" || state === "completed") {
      try {
        await existingJob.remove();
      } catch (error) {
        if ((await existingJob.getState()) !== "active") {
          throw error;
        }
      }
    }
  }

  const jobData = sheetsSyncJobDataSchema.parse({
    formId: params.formId,
    integrationId: params.integrationId,
    mode: "incremental",
    responseId: params.responseId,
    snapshotVersion: params.snapshotVersion,
    refreshValidationOutputs: true,
  });
  await queue.add("validation-refresh", jobData, { jobId });
}
