import { z } from "zod";

export const autosaveDataSchema = z.object({
  formId: z.string(),
  respondentUuid: z.string(),
  responses: z.record(z.string(), z.unknown()),
  savedAt: z.string().datetime(),
  version: z.literal(1),
});

export type AutosaveData = z.infer<typeof autosaveDataSchema>;

export const snapshotSchema = z
  .object({
    id: z.string().optional(),
    version: z.number(),
    blocksJson: z.string().optional(),
    isActive: z.boolean().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export const unpublishedChangesSchema = z
  .object({
    hasChanges: z.boolean(),
  })
  .passthrough();

export const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
