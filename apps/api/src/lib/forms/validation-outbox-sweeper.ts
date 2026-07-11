import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  formResponse,
  formValidationRule,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import { genericValidationJobDataSchema } from "@nexus-form/shared";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { z } from "zod";
import { logError } from "../logger";
import { getValidationQueue, isValidServiceName } from "../queues";
import { captureError } from "../sentry";
import {
  getLatestSnapshotByVersion,
  getSnapshotByVersion,
} from "./snapshot-repository";
import { parseValidationRuleSnapshot } from "./validation-rule-repository";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_CLAIM_LEASE_MS = 60_000;
const INITIAL_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const MAX_ENQUEUE_ATTEMPTS = 8;

type SweeperTimer = ReturnType<typeof setInterval> & {
  unref?: () => void;
};

type PendingValidationOutboxRow = {
  id: string;
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  service: string | null;
  formId: string;
  snapshotVersion: number | null;
  liveRuleType: string | null;
  liveConfigJson: unknown;
  enqueueAttemptCount: number;
  enqueueMode: "LEGACY" | "STABLE";
};

type ClaimedValidationOutboxRow = PendingValidationOutboxRow & {
  claimToken: string;
};

/**
 * Counts produced by a single validation outbox sweep.
 */
export type ValidationOutboxSweepResult = {
  /** Number of eligible STABLE PENDING rows claimed from the database. */
  scanned: number;
  /** Number of rows whose validation jobs were enqueued or already represented by the same stable job ID. */
  enqueued: number;
  /** Number of rows moved to FAILED because they could not be recovered. */
  failed: number;
  /** Number of transient enqueue failures scheduled for a later sweep. */
  retryScheduled: number;
};

/**
 * Controller for the API-side validation outbox recovery loop.
 */
export type ValidationOutboxSweeper = {
  /** Runs one sweep and returns its counts. Concurrent calls share the same in-flight promise. */
  runOnce: () => Promise<ValidationOutboxSweepResult>;
  /** Starts an immediate sweep and a recurring interval. Repeated calls are no-ops while started. */
  start: () => void;
  /** Stops the recurring interval and waits for any in-flight sweep to settle. */
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

function snapshotRuleMapKey(
  formId: string,
  snapshotVersion: number | null,
  ruleId: string,
): string {
  return `${formId}:${snapshotVersion ?? "latest"}:${ruleId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function markValidationOutboxFailed(
  row: ClaimedValidationOutboxRow,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(externalServiceValidationResult)
    .set({
      status: "FAILED",
      errorCode,
      errorMessage,
      enqueueAttemptCount: row.enqueueAttemptCount + 1,
      nextEligibleAt: null,
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        eq(externalServiceValidationResult.id, row.id),
        eq(externalServiceValidationResult.status, "PENDING"),
        eq(externalServiceValidationResult.enqueueMode, "STABLE"),
        isNull(externalServiceValidationResult.jobId),
        eq(externalServiceValidationResult.claimToken, row.claimToken),
      ),
    );
}

async function persistValidationOutboxJobId(
  row: ClaimedValidationOutboxRow,
  jobId: string,
): Promise<void> {
  await db
    .update(externalServiceValidationResult)
    .set({
      jobId,
      errorCode: null,
      errorMessage: null,
      enqueueAttemptCount: row.enqueueAttemptCount + 1,
      nextEligibleAt: null,
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        eq(externalServiceValidationResult.id, row.id),
        eq(externalServiceValidationResult.status, "PENDING"),
        eq(externalServiceValidationResult.enqueueMode, "STABLE"),
        isNull(externalServiceValidationResult.jobId),
        eq(externalServiceValidationResult.claimToken, row.claimToken),
      ),
    );
}

function retryDelayMs(attempt: number, random: () => number): number {
  const baseDelay = Math.min(
    INITIAL_BACKOFF_MS * 2 ** Math.max(0, attempt - 1),
    MAX_BACKOFF_MS,
  );
  const jitter = Math.floor(
    Math.min(1, Math.max(0, random())) * INITIAL_BACKOFF_MS,
  );
  return Math.min(MAX_BACKOFF_MS, baseDelay + jitter);
}

function validationOutboxEligibilityCondition(now: Date, cutoff: Date) {
  return and(
    or(
      lte(externalServiceValidationResult.nextEligibleAt, now),
      and(
        isNull(externalServiceValidationResult.nextEligibleAt),
        lte(externalServiceValidationResult.createdAt, cutoff),
      ),
    ),
    or(
      isNull(externalServiceValidationResult.claimToken),
      lte(externalServiceValidationResult.claimExpiresAt, now),
    ),
  );
}

async function releaseValidationOutboxClaim(
  row: ClaimedValidationOutboxRow,
  now: Date,
  random: () => number,
  error: unknown,
): Promise<"retrying" | "failed"> {
  const enqueueAttemptCount = row.enqueueAttemptCount + 1;
  const terminal = enqueueAttemptCount >= MAX_ENQUEUE_ATTEMPTS;
  const errorMessage = error instanceof Error ? error.message : String(error);

  await db
    .update(externalServiceValidationResult)
    .set(
      terminal
        ? {
            status: "FAILED",
            errorCode: "ENQUEUE_RETRY_EXHAUSTED",
            errorMessage: "Validation job enqueue retry limit exceeded",
            enqueueAttemptCount,
            nextEligibleAt: null,
            claimToken: null,
            claimExpiresAt: null,
          }
        : {
            errorCode: "ENQUEUE_FAILED",
            errorMessage,
            enqueueAttemptCount,
            nextEligibleAt: new Date(
              now.getTime() + retryDelayMs(enqueueAttemptCount, random),
            ),
            claimToken: null,
            claimExpiresAt: null,
          },
    )
    .where(
      and(
        eq(externalServiceValidationResult.id, row.id),
        eq(externalServiceValidationResult.status, "PENDING"),
        eq(externalServiceValidationResult.enqueueMode, "STABLE"),
        isNull(externalServiceValidationResult.jobId),
        eq(externalServiceValidationResult.claimToken, row.claimToken),
      ),
    );

  return terminal ? "failed" : "retrying";
}

async function claimPendingValidationOutboxRows(options: {
  cutoff: Date;
  batchSize: number;
  leaseMs: number;
  now: Date;
}): Promise<ClaimedValidationOutboxRow[]> {
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(options.now.getTime() + options.leaseMs);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: externalServiceValidationResult.id,
        responseId: externalServiceValidationResult.responseId,
        ruleId: externalServiceValidationResult.ruleId,
        referencedBlockId: externalServiceValidationResult.referencedBlockId,
        service: externalServiceValidationResult.service,
        formId: formResponse.formId,
        snapshotVersion: externalServiceValidationResult.snapshotVersion,
        liveRuleType: formValidationRule.ruleType,
        liveConfigJson: formValidationRule.configJson,
        enqueueAttemptCount:
          externalServiceValidationResult.enqueueAttemptCount,
        enqueueMode: externalServiceValidationResult.enqueueMode,
      })
      .from(externalServiceValidationResult)
      .innerJoin(
        formResponse,
        eq(formResponse.id, externalServiceValidationResult.responseId),
      )
      .leftJoin(
        formValidationRule,
        eq(formValidationRule.id, externalServiceValidationResult.ruleId),
      )
      .where(
        and(
          eq(externalServiceValidationResult.status, "PENDING"),
          eq(externalServiceValidationResult.enqueueMode, "STABLE"),
          isNull(externalServiceValidationResult.jobId),
          validationOutboxEligibilityCondition(options.now, options.cutoff),
        ),
      )
      .orderBy(asc(externalServiceValidationResult.createdAt))
      .limit(options.batchSize)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    await tx
      .update(externalServiceValidationResult)
      .set({ claimToken, claimExpiresAt })
      .where(
        and(
          inArray(
            externalServiceValidationResult.id,
            rows.map((row) => row.id),
          ),
          eq(externalServiceValidationResult.status, "PENDING"),
          eq(externalServiceValidationResult.enqueueMode, "STABLE"),
          isNull(externalServiceValidationResult.jobId),
          validationOutboxEligibilityCondition(options.now, options.cutoff),
        ),
      );

    return rows.map((row) => ({ ...row, claimToken }));
  });
}

async function findPendingValidationOutboxRows(
  cutoff: Date,
  batchSize: number,
  now: Date,
  leaseMs: number,
): Promise<ClaimedValidationOutboxRow[]> {
  return claimPendingValidationOutboxRows({
    cutoff,
    batchSize,
    now,
    leaseMs,
  });
}

async function buildSnapshotRuleMap(
  rows: PendingValidationOutboxRow[],
): Promise<
  Map<string, { ruleType: string; configJson: Record<string, unknown> }>
> {
  const needsSnapshot = rows.filter(
    (row) =>
      row.snapshotVersion !== null ||
      row.liveRuleType === null ||
      !isRecord(row.liveConfigJson),
  );
  const snapshotKeys = new Map(
    needsSnapshot.map((row) => [
      `${row.formId}:${row.snapshotVersion ?? "latest"}`,
      { formId: row.formId, snapshotVersion: row.snapshotVersion },
    ]),
  );
  const snapshotRules = new Map<
    string,
    { ruleType: string; configJson: Record<string, unknown> }
  >();

  await Promise.all(
    Array.from(snapshotKeys.values()).map(
      async ({ formId, snapshotVersion }) => {
        const snapshot =
          snapshotVersion === null
            ? await getLatestSnapshotByVersion(formId)
            : await getSnapshotByVersion(formId, snapshotVersion);
        if (!snapshot?.validationRulesJson) return;

        for (const entry of parseValidationRuleSnapshot(
          snapshot.validationRulesJson,
        )) {
          snapshotRules.set(
            snapshotRuleMapKey(formId, snapshotVersion, entry.id),
            {
              ruleType: entry.ruleType,
              configJson: entry.configJson,
            },
          );
        }
      },
    ),
  );

  return snapshotRules;
}

async function enqueuePendingValidationOutboxRow(
  row: ClaimedValidationOutboxRow,
  snapshotRules: Map<
    string,
    { ruleType: string; configJson: Record<string, unknown> }
  >,
  options: { now: Date; random: () => number },
): Promise<"enqueued" | "failed" | "retrying"> {
  if (!row.service || !isValidServiceName(row.service)) {
    await markValidationOutboxFailed(
      row,
      "INVALID_SERVICE_NAME",
      `Invalid service name: ${row.service ?? ""}`,
    );
    return "failed";
  }

  const snapshotEntry = snapshotRules.get(
    snapshotRuleMapKey(row.formId, row.snapshotVersion, row.ruleId),
  );
  if (row.snapshotVersion !== null && !snapshotEntry) {
    await markValidationOutboxFailed(
      row,
      "RULE_CONFIG_NOT_FOUND",
      "Validation rule configuration was not found in response snapshot",
    );
    return "failed";
  }

  const ruleType = snapshotEntry?.ruleType ?? row.liveRuleType ?? null;
  const configJson =
    snapshotEntry?.configJson ??
    (isRecord(row.liveConfigJson) ? row.liveConfigJson : null) ??
    null;

  if (!ruleType || !configJson) {
    await markValidationOutboxFailed(
      row,
      "RULE_CONFIG_NOT_FOUND",
      "Validation rule configuration was not found for pending outbox row",
    );
    return "failed";
  }

  const provider = providerRegistry.get(row.service);
  if (!provider) {
    await markValidationOutboxFailed(
      row,
      "PROVIDER_NOT_REGISTERED",
      `Validation provider not registered: ${row.service}`,
    );
    return "failed";
  }
  if (!provider.rules[ruleType]) {
    await markValidationOutboxFailed(
      row,
      "UNKNOWN_RULE_TYPE",
      `Provider ${row.service} does not expose rule: ${ruleType}`,
    );
    return "failed";
  }

  let jobData: z.infer<typeof genericValidationJobDataSchema>;
  try {
    jobData = genericValidationJobDataSchema.parse({
      responseId: row.responseId,
      ruleId: row.ruleId,
      referencedBlockId: row.referencedBlockId,
      snapshotProviderName: row.service,
      snapshotRuleType: ruleType,
      snapshotConfigJson: configJson,
      snapshotVersion: row.snapshotVersion ?? undefined,
    });
  } catch (error) {
    logError("Failed to prepare validation outbox job", "api", {
      error,
      resultId: row.id,
      responseId: row.responseId,
      ruleId: row.ruleId,
      service: row.service,
      formId: row.formId,
    });
    await markValidationOutboxFailed(
      row,
      "ENQUEUE_FAILED",
      "Failed to prepare validation job",
    );
    return "failed";
  }

  const jobId = buildValidationOutboxJobId(row.id);

  try {
    const queue = getValidationQueue(row.service);
    await queue.add(`validate-${row.service}`, jobData, { jobId });
  } catch (error) {
    logError("Failed to enqueue validation outbox job", "api", {
      error,
      resultId: row.id,
      responseId: row.responseId,
      ruleId: row.ruleId,
      service: row.service,
      formId: row.formId,
      jobId,
    });
    captureError(error);
    let recovery: "retrying" | "failed" = "retrying";
    try {
      recovery = await releaseValidationOutboxClaim(
        row,
        options.now,
        options.random,
        error,
      );
    } catch (updateError) {
      logError(
        "Failed to release validation outbox claim after enqueue error",
        "api",
        { error: updateError, resultId: row.id, jobId },
      );
      captureError(updateError);
    }
    return recovery;
  }

  try {
    await persistValidationOutboxJobId(row, jobId);
  } catch (error) {
    logError("Failed to persist validation outbox jobId", "api", {
      error,
      resultId: row.id,
      responseId: row.responseId,
      ruleId: row.ruleId,
      service: row.service,
      formId: row.formId,
      jobId,
    });
    captureError(error);
  }
  return "enqueued";
}

function buildValidationOutboxJobId(resultId: string): string {
  return `validation-outbox-${resultId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * Recovers eligible STABLE validation outbox rows by claiming up to
 * `batchSize` rows, resolving their response snapshot rule config, and
 * enqueueing validation jobs for recoverable rows. Initial rows must be older
 * than `staleMs`; rows with a retry eligibility timestamp use that timestamp.
 *
 * `batchSize` defaults to `DEFAULT_BATCH_SIZE` and is capped at
 * `MAX_BATCH_SIZE`; `staleMs` defaults to `DEFAULT_STALE_MS`. The returned
 * counts report scanned rows, successfully enqueued rows, and rows marked
 * failed because they cannot be recovered.
 */
export async function sweepValidationOutbox(
  options: {
    batchSize?: number;
    staleMs?: number;
    leaseMs?: number;
    now?: Date;
    random?: () => number;
  } = {},
): Promise<ValidationOutboxSweepResult> {
  const batchSize = Math.min(
    Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );
  const staleMs = Math.max(0, options.staleMs ?? DEFAULT_STALE_MS);
  const leaseMs = Math.max(1, options.leaseMs ?? DEFAULT_CLAIM_LEASE_MS);
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const cutoff = new Date(now.getTime() - staleMs);
  const rows = await findPendingValidationOutboxRows(
    cutoff,
    batchSize,
    now,
    leaseMs,
  );
  const snapshotRules = await buildSnapshotRuleMap(rows);
  const result: ValidationOutboxSweepResult = {
    scanned: rows.length,
    enqueued: 0,
    failed: 0,
    retryScheduled: 0,
  };

  for (const row of rows) {
    const outcome = await enqueuePendingValidationOutboxRow(
      row,
      snapshotRules,
      { now, random },
    );
    if (outcome === "enqueued") result.enqueued += 1;
    if (outcome === "failed") result.failed += 1;
    if (outcome === "retrying") result.retryScheduled += 1;
  }

  return result;
}

/**
 * Creates the API-side validation outbox sweeper.
 *
 * The returned controller reads `VALIDATION_OUTBOX_SWEEP_BATCH_SIZE`,
 * `VALIDATION_OUTBOX_SWEEP_STALE_MS`, and
 * `VALIDATION_OUTBOX_SWEEP_INTERVAL_MS` when it is created. `start()` runs one
 * immediate sweep, then schedules recurring sweeps on an unref'd timer.
 * Sweep failures from the recurring loop are logged and captured.
 */
export function createValidationOutboxSweeper(): ValidationOutboxSweeper {
  const batchSize = readPositiveInt(
    process.env.VALIDATION_OUTBOX_SWEEP_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
  );
  const staleMs = readPositiveInt(
    process.env.VALIDATION_OUTBOX_SWEEP_STALE_MS,
    DEFAULT_STALE_MS,
  );
  const leaseMs = readPositiveInt(
    process.env.VALIDATION_OUTBOX_SWEEP_CLAIM_LEASE_MS,
    DEFAULT_CLAIM_LEASE_MS,
  );
  const intervalMs = readPositiveInt(
    process.env.VALIDATION_OUTBOX_SWEEP_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
  );

  let timer: SweeperTimer | null = null;
  let running: Promise<ValidationOutboxSweepResult> | null = null;

  const runOnce = (): Promise<ValidationOutboxSweepResult> => {
    if (running) return running;
    running = sweepValidationOutbox({ batchSize, staleMs, leaseMs }).finally(
      () => {
        running = null;
      },
    );
    return running;
  };

  const runAndLog = (): void => {
    runOnce().catch((error) => {
      logError("Validation outbox sweep failed", "api", { error });
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
      if (timer) {
        clearInterval(timer);
      }
      timer = null;
      await running?.catch(() => undefined);
    },
  };
}
