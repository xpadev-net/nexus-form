import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { formResponse, formSubmitOutbox } from "@nexus-form/database/schema";
import {
  FormSubmitNotificationJobDataSchema,
  sheetsSyncJobDataSchema,
} from "@nexus-form/shared";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { logError } from "../logger";
import { getFormSubmitNotificationQueue, getSheetsSyncQueue } from "../queues";
import { captureError } from "../sentry";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_MS = 60_000;
const MAX_ERROR_LENGTH = 2_048;

type SubmitOutboxTimer = ReturnType<typeof setInterval> & {
  unref?: () => void;
};

export type SubmitOutboxEffectType = "NOTIFICATION" | "SHEETS";

export type SubmitOutboxInsert = {
  id: string;
  responseId: string;
  formId: string;
  effectType: SubmitOutboxEffectType;
  snapshotVersion: number | null;
  integrationId: string | null;
};

type ClaimedSubmitOutboxRow = Omit<SubmitOutboxInsert, "effectType"> & {
  effectType: string;
  submittedAt: Date;
  attemptCount: number;
  claimToken: string;
};

export type SubmitOutboxSweepResult = {
  scanned: number;
  enqueued: number;
  failed: number;
};

export type SubmitOutboxSweeper = {
  runOnce: () => Promise<SubmitOutboxSweepResult>;
  start: () => void;
  stop: () => Promise<void>;
};

function readPositiveInt(
  value: string | undefined,
  fallback: number,
  max = Number.POSITIVE_INFINITY,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

export async function insertSubmitOutboxRows(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  rows: SubmitOutboxInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(formSubmitOutbox).values(rows);
}

/**
 * Fails API startup when the additive outbox migration has not run. Deploy the
 * migration before new API replicas; old replicas safely ignore the new table.
 * Submits handled by old replicas during the mixed-version window retain the
 * legacy best-effort guarantee, so durability starts after they are drained.
 */
export async function assertSubmitOutboxMigrationApplied(): Promise<void> {
  await db.select({ id: formSubmitOutbox.id }).from(formSubmitOutbox).limit(1);
}

async function claimSubmitOutboxRows(options: {
  batchSize: number;
  leaseMs: number;
  now: Date;
  responseId?: string;
}): Promise<ClaimedSubmitOutboxRow[]> {
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(options.now.getTime() + options.leaseMs);

  return db.transaction(async (tx) => {
    const pendingConditions = [
      isNull(formSubmitOutbox.enqueuedAt),
      or(
        isNull(formSubmitOutbox.claimExpiresAt),
        lte(formSubmitOutbox.claimExpiresAt, options.now),
      ),
    ];
    if (options.responseId) {
      pendingConditions.push(
        eq(formSubmitOutbox.responseId, options.responseId),
      );
    }

    const rows = await tx
      .select({
        id: formSubmitOutbox.id,
        responseId: formSubmitOutbox.responseId,
        formId: formSubmitOutbox.formId,
        effectType: formSubmitOutbox.effectType,
        snapshotVersion: formSubmitOutbox.snapshotVersion,
        integrationId: formSubmitOutbox.integrationId,
        attemptCount: formSubmitOutbox.attemptCount,
        submittedAt: formResponse.submittedAt,
      })
      .from(formSubmitOutbox)
      .innerJoin(formResponse, eq(formResponse.id, formSubmitOutbox.responseId))
      .where(and(...pendingConditions))
      .orderBy(asc(formSubmitOutbox.createdAt))
      .limit(options.batchSize)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    await tx
      .update(formSubmitOutbox)
      .set({ claimToken, claimExpiresAt })
      .where(
        and(
          inArray(
            formSubmitOutbox.id,
            rows.map((row) => row.id),
          ),
          isNull(formSubmitOutbox.enqueuedAt),
        ),
      );

    return rows.map((row) => ({ ...row, claimToken }));
  });
}

async function enqueueClaimedRow(row: ClaimedSubmitOutboxRow): Promise<void> {
  if (row.effectType === "NOTIFICATION") {
    if (row.snapshotVersion === null) {
      throw new Error("Notification outbox row is missing snapshotVersion");
    }
    const jobData = FormSubmitNotificationJobDataSchema.parse({
      formId: row.formId,
      responseId: row.responseId,
      snapshotVersion: row.snapshotVersion,
      submittedAt: row.submittedAt.toISOString(),
    });
    await getFormSubmitNotificationQueue().add("form-submit", jobData, {
      jobId: row.id,
    });
    return;
  }

  if (row.effectType === "SHEETS") {
    if (!row.integrationId) {
      throw new Error("Sheets outbox row is missing integrationId");
    }
    const jobData = sheetsSyncJobDataSchema.parse({
      formId: row.formId,
      integrationId: row.integrationId,
      responseId: row.responseId,
      snapshotVersion: row.snapshotVersion ?? undefined,
    });
    await getSheetsSyncQueue().add("auto-sync", jobData, { jobId: row.id });
    return;
  }

  throw new Error(`Unsupported submit outbox effect: ${row.effectType}`);
}

async function markEnqueued(row: ClaimedSubmitOutboxRow, now: Date) {
  await db
    .update(formSubmitOutbox)
    .set({
      enqueuedAt: now,
      claimToken: null,
      claimExpiresAt: null,
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      lastError: null,
    })
    .where(
      and(
        eq(formSubmitOutbox.id, row.id),
        eq(formSubmitOutbox.claimToken, row.claimToken),
        isNull(formSubmitOutbox.enqueuedAt),
      ),
    );
}

async function releaseFailedClaim(
  row: ClaimedSubmitOutboxRow,
  now: Date,
  error: unknown,
) {
  await db
    .update(formSubmitOutbox)
    .set({
      claimToken: null,
      claimExpiresAt: null,
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      lastError: errorMessage(error),
    })
    .where(
      and(
        eq(formSubmitOutbox.id, row.id),
        eq(formSubmitOutbox.claimToken, row.claimToken),
        isNull(formSubmitOutbox.enqueuedAt),
      ),
    );
}

/**
 * Enqueues claimed rows with at-least-once semantics. A crash after queue.add
 * but before markEnqueued leaves the lease to expire and intentionally replays
 * the same stable job ID. Generic webhooks carry a stable delivery ID for
 * receiver-side dedupe; Discord cannot offer that guarantee and may duplicate.
 */
export async function sweepSubmitOutbox(
  options: {
    batchSize?: number;
    leaseMs?: number;
    now?: Date;
    responseId?: string;
  } = {},
): Promise<SubmitOutboxSweepResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.min(
    Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1),
    MAX_BATCH_SIZE,
  );
  const leaseMs = Math.max(options.leaseMs ?? DEFAULT_LEASE_MS, 1);
  const rows = await claimSubmitOutboxRows({
    batchSize,
    leaseMs,
    now,
    responseId: options.responseId,
  });
  const result: SubmitOutboxSweepResult = {
    scanned: rows.length,
    enqueued: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      await enqueueClaimedRow(row);
    } catch (error) {
      result.failed += 1;
      logError("Failed to enqueue durable submit side effect", "api", {
        error,
        outboxId: row.id,
        responseId: row.responseId,
        effectType: row.effectType,
      });
      captureError(error);
      await releaseFailedClaim(row, now, error);
      continue;
    }

    result.enqueued += 1;
    try {
      await markEnqueued(row, now);
    } catch (error) {
      // Do not release the claim: its expiry is the recovery signal for the
      // queue-success/DB-ack crash ambiguity.
      logError("Failed to acknowledge enqueued submit side effect", "api", {
        error,
        outboxId: row.id,
        responseId: row.responseId,
        effectType: row.effectType,
      });
      captureError(error);
    }
  }

  return result;
}

export function createSubmitOutboxSweeper(): SubmitOutboxSweeper {
  const batchSize = readPositiveInt(
    process.env.SUBMIT_OUTBOX_SWEEP_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
  );
  const intervalMs = readPositiveInt(
    process.env.SUBMIT_OUTBOX_SWEEP_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
  );
  const leaseMs = readPositiveInt(
    process.env.SUBMIT_OUTBOX_CLAIM_LEASE_MS,
    DEFAULT_LEASE_MS,
  );
  let timer: SubmitOutboxTimer | null = null;
  let running: Promise<SubmitOutboxSweepResult> | null = null;

  const runOnce = (): Promise<SubmitOutboxSweepResult> => {
    if (running) return running;
    running = sweepSubmitOutbox({ batchSize, leaseMs }).finally(() => {
      running = null;
    });
    return running;
  };

  const runAndLog = (): void => {
    runOnce().catch((error) => {
      logError("Submit outbox sweep failed", "api", { error });
      captureError(error);
    });
  };

  return {
    runOnce,
    start: () => {
      if (timer) return;
      runAndLog();
      timer = setInterval(runAndLog, intervalMs);
      timer.unref?.();
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await running?.catch(() => undefined);
    },
  };
}

export function recoverSubmitOutboxForResponse(responseId: string): void {
  // Keep queue availability outside response latency and transaction tests;
  // the committed row is also covered by the startup/interval sweeper.
  const timer = setTimeout(() => {
    void sweepSubmitOutbox({ batchSize: 2, responseId }).catch((error) => {
      logError("Immediate submit outbox recovery failed", "api", {
        error,
        responseId,
      });
      captureError(error);
    });
  }, 0);
  timer.unref?.();
}
