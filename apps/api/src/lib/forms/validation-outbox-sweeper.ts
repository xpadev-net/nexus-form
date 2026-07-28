import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  formResponse,
  formValidationRule,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import {
  buildValidationOutboxJobId,
  genericValidationJobDataSchema,
} from "@nexus-form/shared";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
const SERVER_CURRENT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;

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
): Promise<boolean> {
  try {
    const [result] = await db
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
    return result.affectedRows > 0;
  } catch (error) {
    logError("Failed to mark validation outbox row as failed", "api", {
      error,
      resultId: row.id,
    });
    captureError(error);
    return false;
  }
}

async function persistValidationOutboxJobId(
  row: ClaimedValidationOutboxRow,
  jobId: string,
): Promise<boolean> {
  const [result] = await db
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
  return result.affectedRows > 0;
}

async function renewValidationOutboxClaim(
  row: ClaimedValidationOutboxRow,
  leaseSeconds: number,
): Promise<boolean> {
  const [result] = await db
    .update(externalServiceValidationResult)
    .set({
      claimExpiresAt: sql`TIMESTAMPADD(SECOND, ${leaseSeconds}, CURRENT_TIMESTAMP)`,
    })
    .where(
      and(
        eq(externalServiceValidationResult.id, row.id),
        eq(externalServiceValidationResult.status, "PENDING"),
        eq(externalServiceValidationResult.enqueueMode, "STABLE"),
        isNull(externalServiceValidationResult.jobId),
        eq(externalServiceValidationResult.claimToken, row.claimToken),
        gt(
          externalServiceValidationResult.claimExpiresAt,
          SERVER_CURRENT_TIMESTAMP,
        ),
      ),
    );
  return result.affectedRows > 0;
}

function retryDelayMs(attempt: number, random: () => number): number {
  const baseDelay = Math.min(
    INITIAL_BACKOFF_MS * 2 ** Math.max(0, attempt - 1),
    MAX_BACKOFF_MS,
  );
  const jitterFloor =
    baseDelay === MAX_BACKOFF_MS
      ? MAX_BACKOFF_MS - INITIAL_BACKOFF_MS
      : baseDelay;
  const jitter = Math.floor(
    Math.min(1, Math.max(0, random())) * INITIAL_BACKOFF_MS,
  );
  return Math.min(MAX_BACKOFF_MS, jitterFloor + jitter);
}

function validationOutboxEligibilityCondition(staleSeconds: number) {
  return and(
    or(
      lte(
        externalServiceValidationResult.nextEligibleAt,
        SERVER_CURRENT_TIMESTAMP,
      ),
      and(
        isNull(externalServiceValidationResult.nextEligibleAt),
        lte(
          externalServiceValidationResult.createdAt,
          sql`TIMESTAMPADD(SECOND, ${-staleSeconds}, CURRENT_TIMESTAMP)`,
        ),
      ),
    ),
    or(
      isNull(externalServiceValidationResult.claimToken),
      lte(
        externalServiceValidationResult.claimExpiresAt,
        SERVER_CURRENT_TIMESTAMP,
      ),
    ),
  );
}

async function releaseValidationOutboxClaim(
  row: ClaimedValidationOutboxRow,
  random: () => number,
  error: unknown,
): Promise<"retrying" | "failed" | "unresolved"> {
  const enqueueAttemptCount = row.enqueueAttemptCount + 1;
  const terminal = enqueueAttemptCount >= MAX_ENQUEUE_ATTEMPTS;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const retryDelaySeconds = Math.ceil(
    retryDelayMs(enqueueAttemptCount, random) / 1_000,
  );

  const [result] = await db
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
            nextEligibleAt: sql`TIMESTAMPADD(SECOND, ${retryDelaySeconds}, CURRENT_TIMESTAMP)`,
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

  if (result.affectedRows === 0) return "unresolved";
  return terminal ? "failed" : "retrying";
}

async function claimPendingValidationOutboxRows(options: {
  staleSeconds: number;
  batchSize: number;
  leaseSeconds: number;
}): Promise<ClaimedValidationOutboxRow[]> {
  const claimToken = randomUUID();

  return db.transaction(async (tx) => {
    // TiDB's planner can fail with "Can't find column ... in schema" when a
    // locking read (FOR UPDATE [SKIP LOCKED]) is combined with a JOIN. Lock
    // the candidate rows from a single table first, then fetch the
    // JOIN-derived enrichment data in a separate, non-locking read — the
    // row locks from the first query already hold these rows for the rest
    // of the transaction.
    const lockedRows = await tx
      .select({
        id: externalServiceValidationResult.id,
        responseId: externalServiceValidationResult.responseId,
        ruleId: externalServiceValidationResult.ruleId,
        referencedBlockId: externalServiceValidationResult.referencedBlockId,
        service: externalServiceValidationResult.service,
        snapshotVersion: externalServiceValidationResult.snapshotVersion,
        enqueueAttemptCount:
          externalServiceValidationResult.enqueueAttemptCount,
        enqueueMode: externalServiceValidationResult.enqueueMode,
      })
      .from(externalServiceValidationResult)
      .where(
        and(
          eq(externalServiceValidationResult.status, "PENDING"),
          eq(externalServiceValidationResult.enqueueMode, "STABLE"),
          isNull(externalServiceValidationResult.jobId),
          validationOutboxEligibilityCondition(options.staleSeconds),
        ),
      )
      .orderBy(asc(externalServiceValidationResult.createdAt))
      .limit(options.batchSize)
      .for("update", { skipLocked: true });

    if (lockedRows.length === 0) return [];

    const ids = lockedRows.map((row) => row.id);

    const enrichmentRows = await tx
      .select({
        id: externalServiceValidationResult.id,
        formId: formResponse.formId,
        liveRuleType: formValidationRule.ruleType,
        liveConfigJson: formValidationRule.configJson,
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
      .where(inArray(externalServiceValidationResult.id, ids));

    const enrichmentById = new Map(enrichmentRows.map((row) => [row.id, row]));

    const rows: PendingValidationOutboxRow[] = lockedRows.map((row) => {
      const enrichment = enrichmentById.get(row.id);
      return {
        id: row.id,
        responseId: row.responseId,
        ruleId: row.ruleId,
        referencedBlockId: row.referencedBlockId,
        service: row.service,
        formId: enrichment?.formId ?? "",
        snapshotVersion: row.snapshotVersion,
        liveRuleType: enrichment?.liveRuleType ?? null,
        liveConfigJson: enrichment?.liveConfigJson ?? null,
        enqueueAttemptCount: row.enqueueAttemptCount,
        enqueueMode: row.enqueueMode,
      };
    });

    await tx
      .update(externalServiceValidationResult)
      .set({
        claimToken,
        claimExpiresAt: sql`TIMESTAMPADD(SECOND, ${options.leaseSeconds}, CURRENT_TIMESTAMP)`,
      })
      .where(
        and(
          inArray(externalServiceValidationResult.id, ids),
          eq(externalServiceValidationResult.status, "PENDING"),
          eq(externalServiceValidationResult.enqueueMode, "STABLE"),
          isNull(externalServiceValidationResult.jobId),
          validationOutboxEligibilityCondition(options.staleSeconds),
        ),
      );

    return rows.map((row) => ({ ...row, claimToken }));
  });
}

async function findPendingValidationOutboxRows(
  staleSeconds: number,
  batchSize: number,
  leaseSeconds: number,
): Promise<ClaimedValidationOutboxRow[]> {
  return claimPendingValidationOutboxRows({
    staleSeconds,
    batchSize,
    leaseSeconds,
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
  options: {
    leaseSeconds: number;
    random: () => number;
  },
): Promise<"enqueued" | "failed" | "retrying" | "unresolved"> {
  if (!row.service || !isValidServiceName(row.service)) {
    const marked = await markValidationOutboxFailed(
      row,
      "INVALID_SERVICE_NAME",
      `Invalid service name: ${row.service ?? ""}`,
    );
    return marked ? "failed" : "unresolved";
  }

  const snapshotEntry = snapshotRules.get(
    snapshotRuleMapKey(row.formId, row.snapshotVersion, row.ruleId),
  );
  if (row.snapshotVersion !== null && !snapshotEntry) {
    const marked = await markValidationOutboxFailed(
      row,
      "RULE_CONFIG_NOT_FOUND",
      "Validation rule configuration was not found in response snapshot",
    );
    return marked ? "failed" : "unresolved";
  }

  const ruleType = snapshotEntry?.ruleType ?? row.liveRuleType ?? null;
  const configJson =
    snapshotEntry?.configJson ??
    (isRecord(row.liveConfigJson) ? row.liveConfigJson : null) ??
    null;

  if (!ruleType || !configJson) {
    const marked = await markValidationOutboxFailed(
      row,
      "RULE_CONFIG_NOT_FOUND",
      "Validation rule configuration was not found for pending outbox row",
    );
    return marked ? "failed" : "unresolved";
  }

  const provider = providerRegistry.get(row.service);
  if (!provider) {
    const marked = await markValidationOutboxFailed(
      row,
      "PROVIDER_NOT_REGISTERED",
      `Validation provider not registered: ${row.service}`,
    );
    return marked ? "failed" : "unresolved";
  }
  if (!provider.rules[ruleType]) {
    const marked = await markValidationOutboxFailed(
      row,
      "UNKNOWN_RULE_TYPE",
      `Provider ${row.service} does not expose rule: ${ruleType}`,
    );
    return marked ? "failed" : "unresolved";
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
    const marked = await markValidationOutboxFailed(
      row,
      "ENQUEUE_FAILED",
      "Failed to prepare validation job",
    );
    return marked ? "failed" : "unresolved";
  }

  const jobId = buildValidationOutboxJobId(row.id);

  try {
    let claimRenewed = false;
    try {
      claimRenewed = await renewValidationOutboxClaim(
        row,
        options.leaseSeconds,
      );
    } catch (error) {
      logError("Failed to renew validation outbox claim", "api", {
        error,
        resultId: row.id,
        jobId,
      });
      captureError(error);
    }
    if (!claimRenewed) return "unresolved";

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
    let recovery: "retrying" | "failed" | "unresolved" = "unresolved";
    try {
      recovery = await releaseValidationOutboxClaim(row, options.random, error);
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
    const persisted = await persistValidationOutboxJobId(row, jobId);
    if (!persisted) return "unresolved";
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
    return "unresolved";
  }
  return "enqueued";
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
    clock?: () => Date;
    random?: () => number;
  } = {},
): Promise<ValidationOutboxSweepResult> {
  const batchSize = Math.min(
    Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );
  const staleMs = Math.max(0, options.staleMs ?? DEFAULT_STALE_MS);
  const leaseMs = Math.max(1, options.leaseMs ?? DEFAULT_CLAIM_LEASE_MS);
  const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1_000));
  const staleSeconds = Math.ceil(staleMs / 1_000);
  const random = options.random ?? Math.random;
  const rows = await findPendingValidationOutboxRows(
    staleSeconds,
    batchSize,
    leaseSeconds,
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
      { leaseSeconds, random },
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
