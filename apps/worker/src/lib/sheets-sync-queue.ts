import { createHash } from "node:crypto";
import { db, formSubmitOutbox } from "@nexus-form/database";
import {
  type SheetsSyncJobData,
  sheetsSyncJobDataSchema,
} from "@nexus-form/shared";
import { type DefaultJobOptions, Queue } from "bullmq";
import { sql } from "drizzle-orm";
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

function buildValidationRefreshKey(params: {
  validationResultId: string;
  snapshotVersion?: number;
}): {
  effectType: string;
  id: string;
  jobId: string;
} {
  const hash = createHash("sha256")
    .update(params.validationResultId)
    .update("\0")
    .update(params.snapshotVersion?.toString() ?? "")
    .digest("hex")
    .slice(0, 16);
  return {
    effectType: `SHEETS_REFRESH_${hash}`,
    id: `sheets-refresh.${hash}`,
    jobId: `sheets-refresh.${hash}`,
  };
}

async function addValidationRefreshJobWithCleanup(params: {
  jobData: SheetsSyncJobData;
  jobId: string;
}): Promise<void> {
  const queue = getSheetsSyncQueue();
  const existingJob = await queue.getJob(params.jobId);
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
  await queue.add("validation-refresh", params.jobData, {
    jobId: params.jobId,
  });
}

async function persistValidationRefreshOutboxRow(params: {
  formId: string;
  integrationId: string;
  responseId: string;
  snapshotVersion?: number;
  validationResultId: string;
}): Promise<void> {
  const refreshKey = buildValidationRefreshKey({
    validationResultId: params.validationResultId,
    snapshotVersion: params.snapshotVersion,
  });
  const now = new Date();
  await db
    .insert(formSubmitOutbox)
    .values({
      id: refreshKey.id,
      responseId: params.responseId,
      formId: params.formId,
      effectType: refreshKey.effectType,
      snapshotVersion: params.snapshotVersion ?? null,
      integrationId: params.integrationId,
      enqueuedAt: null,
      claimToken: null,
      claimExpiresAt: null,
      attemptCount: 0,
      lastAttemptAt: now,
      lastError: null,
    })
    .onDuplicateKeyUpdate({
      set: {
        snapshotVersion: params.snapshotVersion ?? null,
        integrationId: params.integrationId,
        enqueuedAt: null,
        claimToken: null,
        claimExpiresAt: null,
        attemptCount: sql`${formSubmitOutbox.attemptCount} + 1`,
        lastAttemptAt: now,
        lastError: null,
      },
    });
}

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
  validationResultId: string;
  snapshotVersion?: number;
}): Promise<void> {
  const refreshKey = buildValidationRefreshKey({
    validationResultId: params.validationResultId,
    snapshotVersion: params.snapshotVersion,
  });
  const jobData = sheetsSyncJobDataSchema.parse({
    formId: params.formId,
    integrationId: params.integrationId,
    mode: "incremental",
    responseId: params.responseId,
    snapshotVersion: params.snapshotVersion,
    refreshValidationOutputs: true,
  });
  try {
    await addValidationRefreshJobWithCleanup({
      jobData,
      jobId: refreshKey.jobId,
    });
  } catch (error) {
    console.warn(
      `[sheets-sync] Failed to enqueue Sheets validation refresh directly; persisting durable outbox row for ${refreshKey.id}:`,
      error,
    );
    await persistValidationRefreshOutboxRow({
      formId: params.formId,
      integrationId: params.integrationId,
      responseId: params.responseId,
      snapshotVersion: params.snapshotVersion,
      validationResultId: params.validationResultId,
    });
  }
}
