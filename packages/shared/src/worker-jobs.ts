import { z } from "zod";

export const VALIDATION_RETRY_JOB_PREFIX = "validation-retry:";

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
