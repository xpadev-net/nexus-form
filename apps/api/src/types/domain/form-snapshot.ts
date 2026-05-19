import { z } from "zod";

export const FormSnapshotListItemSchema = z.object({
  id: z.string(),
  formId: z.string(),
  version: z.number().int().min(1),
  isActive: z.boolean(),
  publishedBy: z.string().nullable(),
  publishedAt: z.date(),
  changeLog: z.string().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  parentVersion: z.number().int().nullish(),
});

export const FormSnapshotSchema = FormSnapshotListItemSchema.extend({
  plateContent: z.string(),
  validationRulesJson: z.string(),
});

export type FormSnapshot = z.infer<typeof FormSnapshotSchema>;

export const RestoreEditResponseSchema = z.object({
  ok: z.boolean(),
  plateContent: z.string(),
});
export type RestoreEditResponse = z.infer<typeof RestoreEditResponseSchema>;

export const UnpublishedChangesInfoSchema = z.object({
  hasChanges: z.boolean(),
  hasValidationRuleChanges: z.boolean(),
  lastPublishedAt: z.date().nullable(),
});
export type UnpublishedChangesInfo = z.infer<
  typeof UnpublishedChangesInfoSchema
>;

export const NodeDiffSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string().nullable(),
  diffType: z.enum(["added", "removed", "modified"]),
});
export type NodeDiff = z.infer<typeof NodeDiffSchema>;

export const FormDiffResultSchema = z.object({
  formId: z.string(),
  hasUnpublishedChanges: z.boolean(),
  hasChangesFromActive: z.boolean(),
  hasValidationRuleChanges: z.boolean(),
  nodes: z.array(NodeDiffSchema),
  totalChanges: z.number().int(),
  lastChecked: z.date(),
});
export type FormDiffResult = z.infer<typeof FormDiffResultSchema>;
