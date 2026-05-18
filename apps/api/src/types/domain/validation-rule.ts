import { z } from "zod";
import { ExternalValidationService } from "./form-block";

// Rule type identifier: lowercase snake_case, 1-64 chars (matches provider.rule.name).
export const ValidationRuleType = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

export const FormValidationRuleSchema = z.object({
  id: z.string(),
  formId: z.string(),
  name: z.string().min(1).max(200),
  providerName: ExternalValidationService,
  ruleType: ValidationRuleType,
  referencedBlockIds: z.array(z.string().min(1)).min(1),
  configJson: z.record(z.string(), z.unknown()),
  orderIndex: z.number().int().min(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type FormValidationRule = z.infer<typeof FormValidationRuleSchema>;

export const CreateFormValidationRuleSchema = z.object({
  name: z.string().min(1).max(200),
  providerName: ExternalValidationService,
  ruleType: ValidationRuleType,
  referencedBlockIds: z.array(z.string().min(1)).min(1),
  configJson: z.record(z.string(), z.unknown()).default({}),
  orderIndex: z.number().int().min(0).optional(),
});
export type CreateFormValidationRule = z.infer<
  typeof CreateFormValidationRuleSchema
>;

export const UpdateFormValidationRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  providerName: ExternalValidationService.optional(),
  ruleType: ValidationRuleType.optional(),
  referencedBlockIds: z.array(z.string().min(1)).min(1).optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
  orderIndex: z.number().int().min(0).optional(),
});
export type UpdateFormValidationRule = z.infer<
  typeof UpdateFormValidationRuleSchema
>;

export const ReorderFormValidationRulesSchema = z.object({
  orderings: z
    .array(
      z.object({
        ruleId: z.string().min(1),
        orderIndex: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type ReorderFormValidationRules = z.infer<
  typeof ReorderFormValidationRulesSchema
>;
