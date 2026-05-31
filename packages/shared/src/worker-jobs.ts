import { z } from "zod";

/** BullMQ custom job IDs must not contain `:`. */
export const VALIDATION_RETRY_JOB_PREFIX = "validation-retry-";
export const SHEETS_SYNC_AUTO_JOB_PREFIX = "sheets-auto.";
export const SHEETS_SYNC_MANUAL_JOB_PREFIX = "sheets-manual.";

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

function encodeSheetsSyncJobIdSegment(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildValidationRetryJobId(
  validationResultId: string,
  nonce: string,
): string {
  return `${VALIDATION_RETRY_JOB_PREFIX}${sanitizeValidationResultIdForRetryJob(validationResultId)}-${sanitizeRetryJobNonce(nonce)}`;
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
  nonce: string,
): string {
  return `${SHEETS_SYNC_MANUAL_JOB_PREFIX}${encodeSheetsSyncJobIdSegment(integrationId)}.${encodeSheetsSyncJobIdSegment(responseId)}.${encodeSheetsSyncJobIdSegment(nonce)}`;
}

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
  responseId: z.string().min(1),
  snapshotVersion: z.number().int().positive().optional(),
});

export type SheetsSyncJobData = z.infer<typeof sheetsSyncJobDataSchema>;
