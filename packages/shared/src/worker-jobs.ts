import { z } from "zod";

/** BullMQ custom job IDs must not contain `:`. */
export const VALIDATION_OUTBOX_JOB_PREFIX = "validation-outbox-";
export const VALIDATION_RETRY_JOB_PREFIX = "validation-retry-";
export const VALIDATION_REVALIDATION_JOB_PREFIX = "validation-revalidation-";
export const SHEETS_SYNC_AUTO_JOB_PREFIX = "sheets-auto.";
export const SHEETS_SYNC_MANUAL_JOB_PREFIX = "sheets-manual.";
export const RESPONSE_LINK_ANALYSIS_QUEUE = "response-link-analysis";
export const RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS = 10_000;
export const RESPONSE_LINK_ANALYSIS_DIRTY_TTL_SECONDS = 24 * 60 * 60;

export type ResponseLinkAnalysisJobSlot = "primary" | "follow-up" | "overflow";

/**
 * Maps validation result ids (e.g. `validation-result:<hash>`) to a BullMQ-safe segment.
 * Not bijective: `validation-result:abc` and `validation-result-abc` both become
 * `validation-result-abc`. Callers must not parse result ids back out of job ids.
 */
export function sanitizeValidationResultIdForRetryJob(
  validationResultId: string,
): string {
  return validationResultId.replaceAll(":", "-");
}

function sanitizeRetryJobNonce(nonce: string): string {
  return nonce.replaceAll(":", "-");
}

function buildValidationJobId(
  prefix: string,
  validationResultId: string,
  nonce: string,
): string {
  return `${prefix}${sanitizeValidationResultIdForRetryJob(validationResultId)}-${sanitizeRetryJobNonce(nonce)}`;
}

export function buildValidationOutboxJobId(validationResultId: string): string {
  return `${VALIDATION_OUTBOX_JOB_PREFIX}${validationResultId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function encodeSheetsSyncJobIdSegment(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildValidationRetryJobId(
  validationResultId: string,
  nonce: string,
): string {
  return buildValidationJobId(
    VALIDATION_RETRY_JOB_PREFIX,
    validationResultId,
    nonce,
  );
}

export function buildValidationRevalidationJobId(
  validationResultId: string,
  nonce: string,
): string {
  return buildValidationJobId(
    VALIDATION_REVALIDATION_JOB_PREFIX,
    validationResultId,
    nonce,
  );
}

export function buildAutoSheetsSyncJobId(
  integrationId: string,
  responseId: string,
): string {
  return `${SHEETS_SYNC_AUTO_JOB_PREFIX}${encodeSheetsSyncJobIdSegment(integrationId)}.${encodeSheetsSyncJobIdSegment(responseId)}`;
}

export function buildManualSheetsSyncJobId(
  integrationId: string,
  responseId: string,
): string {
  return `${SHEETS_SYNC_MANUAL_JOB_PREFIX}${encodeSheetsSyncJobIdSegment(integrationId)}.${encodeSheetsSyncJobIdSegment(responseId)}`;
}

export function buildResponseLinkAnalysisJobId(
  formId: string,
  slot: ResponseLinkAnalysisJobSlot = "primary",
): string {
  const base = `response-link-analysis.${formId}`;
  return slot === "primary" ? base : `${base}.${slot}`;
}

export function buildResponseLinkAnalysisDirtyJobId(
  formId: string,
  scheduledAtMs: number = Date.now(),
): string {
  const bucket = Math.floor(
    (scheduledAtMs + RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS) /
      RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
  );
  return `${buildResponseLinkAnalysisJobId(formId)}.dirty.${bucket}`;
}

export function getResponseLinkAnalysisDirtyKey(formId: string): string {
  return `response-link-analysis:dirty:${formId}`;
}

export const sheetsSyncModeSchema = z.enum(["incremental", "full"]);
export type SheetsSyncMode = z.infer<typeof sheetsSyncModeSchema>;

export const genericValidationJobDataSchema = z.object({
  responseId: z.string().min(1),
  ruleId: z.string().min(1),
  referencedBlockId: z.string().min(1),
  snapshotProviderName: z.string().min(1),
  snapshotRuleType: z.string().min(1),
  snapshotConfigJson: z.record(z.string(), z.unknown()),
  snapshotVersion: z.number().int().positive().optional(),
  retryAfterCount: z.number().int().nonnegative().optional(),
});

export type GenericValidationJobData = z.infer<
  typeof genericValidationJobDataSchema
>;

export const sheetsSyncJobDataSchema = z.object({
  formId: z.string().min(1),
  integrationId: z.string().min(1),
  mode: sheetsSyncModeSchema.default("incremental"),
  responseId: z.string().min(1),
  snapshotVersion: z.number().int().positive().optional(),
  refreshValidationOutputs: z.boolean().optional(),
});

export type SheetsSyncJobData = z.infer<typeof sheetsSyncJobDataSchema>;

export const responseLinkAnalysisJobDataSchema = z.object({
  formId: z.string().min(1),
  reason: z.enum(["response-submitted", "response-deleted", "manual"]),
});

export type ResponseLinkAnalysisJobData = z.infer<
  typeof responseLinkAnalysisJobDataSchema
>;
