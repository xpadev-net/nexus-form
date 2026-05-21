import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  formResponse,
  formValidationRule,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import { genericValidationJobDataSchema } from "@nexus-form/shared";
import { and, eq, isNull, lte } from "drizzle-orm";
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
};

/**
 * Counts produced by a single validation outbox sweep.
 */
export type ValidationOutboxSweepResult = {
  /** Number of stale PENDING rows loaded from the database. */
  scanned: number;
  /** Number of rows whose validation jobs were enqueued or already represented by the same stable job ID. */
  enqueued: number;
  /** Number of rows moved to FAILED because they could not be recovered. */
  failed: number;
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
  resultId: string,
  errorCode: string,
  errorMessage: string,
  jobId?: string,
): Promise<void> {
  const conditions = [
    eq(externalServiceValidationResult.id, resultId),
    eq(externalServiceValidationResult.status, "PENDING"),
  ];
  if (jobId) {
    conditions.push(eq(externalServiceValidationResult.jobId, jobId));
  } else {
    conditions.push(isNull(externalServiceValidationResult.jobId));
  }

  await db
    .update(externalServiceValidationResult)
    .set({
      status: "FAILED",
      errorCode,
      errorMessage,
    })
    .where(and(...conditions));
}

async function persistValidationOutboxJobId(
  resultId: string,
  jobId: string,
): Promise<void> {
  await db
    .update(externalServiceValidationResult)
    .set({
      jobId,
      errorCode: null,
      errorMessage: null,
    })
    .where(
      and(
        eq(externalServiceValidationResult.id, resultId),
        eq(externalServiceValidationResult.status, "PENDING"),
        isNull(externalServiceValidationResult.jobId),
      ),
    );
}

async function findPendingValidationOutboxRows(
  cutoff: Date,
  batchSize: number,
): Promise<PendingValidationOutboxRow[]> {
  return db
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
        isNull(externalServiceValidationResult.jobId),
        lte(externalServiceValidationResult.createdAt, cutoff),
      ),
    )
    .limit(batchSize);
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
          snapshotVersion === null || snapshotVersion === undefined
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
  row: PendingValidationOutboxRow,
  snapshotRules: Map<
    string,
    { ruleType: string; configJson: Record<string, unknown> }
  >,
): Promise<"enqueued" | "failed"> {
  if (!row.service || !isValidServiceName(row.service)) {
    await markValidationOutboxFailed(
      row.id,
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
      row.id,
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
      row.id,
      "RULE_CONFIG_NOT_FOUND",
      "Validation rule configuration was not found for pending outbox row",
    );
    return "failed";
  }

  const provider = providerRegistry.get(row.service);
  if (!provider) {
    await markValidationOutboxFailed(
      row.id,
      "PROVIDER_NOT_REGISTERED",
      `Validation provider not registered: ${row.service}`,
    );
    return "failed";
  }
  if (!provider.rules[ruleType]) {
    await markValidationOutboxFailed(
      row.id,
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
      row.id,
      "ENQUEUE_FAILED",
      "Failed to prepare validation job",
    );
    return "failed";
  }

  const jobId = buildValidationOutboxJobId(row.id);

  const queue = getValidationQueue(row.service);
  try {
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
    try {
      await markValidationOutboxFailed(
        row.id,
        "ENQUEUE_FAILED",
        "Failed to enqueue validation job",
      );
    } catch (updateError) {
      logError(
        "Failed to mark validation outbox row as FAILED after enqueue error",
        "api",
        { error: updateError, resultId: row.id, jobId },
      );
      captureError(updateError);
    }
    return "failed";
  }

  try {
    await persistValidationOutboxJobId(row.id, jobId);
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
 * Recovers stale validation outbox rows by loading up to `batchSize` rows older
 * than `staleMs`, resolving their response snapshot rule config, and enqueueing
 * validation jobs for recoverable rows.
 *
 * `batchSize` defaults to `DEFAULT_BATCH_SIZE` and is capped at
 * `MAX_BATCH_SIZE`; `staleMs` defaults to `DEFAULT_STALE_MS`. The returned
 * counts report scanned rows, successfully enqueued rows, and rows marked
 * failed because they cannot be recovered.
 */
export async function sweepValidationOutbox(
  options: { batchSize?: number; staleMs?: number } = {},
): Promise<ValidationOutboxSweepResult> {
  const batchSize = Math.min(
    Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );
  const staleMs = Math.max(0, options.staleMs ?? DEFAULT_STALE_MS);
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await findPendingValidationOutboxRows(cutoff, batchSize);
  const snapshotRules = await buildSnapshotRuleMap(rows);
  const result: ValidationOutboxSweepResult = {
    scanned: rows.length,
    enqueued: 0,
    failed: 0,
  };

  for (const row of rows) {
    const outcome = await enqueuePendingValidationOutboxRow(row, snapshotRules);
    result[outcome]++;
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
  const intervalMs = readPositiveInt(
    process.env.VALIDATION_OUTBOX_SWEEP_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
  );

  let timer: SweeperTimer | null = null;
  let running: Promise<ValidationOutboxSweepResult> | null = null;

  const runOnce = (): Promise<ValidationOutboxSweepResult> => {
    if (running) return running;
    running = sweepValidationOutbox({ batchSize, staleMs }).finally(() => {
      running = null;
    });
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
      if (timer || intervalMs <= 0) return;
      runAndLog();
      timer = setInterval(runAndLog, intervalMs);
      timer.unref?.();
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
      }
      timer = null;
      await running;
    },
  };
}
