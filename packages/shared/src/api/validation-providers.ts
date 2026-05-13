import { z } from "zod";

export const validationProviderPatternTemplateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  errorMessage: z.string(),
  placeholder: z.string(),
  pattern: z.string().optional(),
  inputType: z.enum(["text", "email"]).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  externalService: z.string().optional(),
});

export const validationProviderConfigOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const validationProviderConfigOptionSourceSchema = z.object({
  endpoint: z.string(),
  collectionPath: z.string(),
  valuePath: z.string(),
  labelPath: z.string(),
  colorPath: z.string().optional(),
  dependsOn: z.string().optional(),
});

export const validationProviderConfigFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  kind: z.enum(["text", "select", "multiselect", "radio"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  options: z.array(validationProviderConfigOptionSchema).optional(),
  optionSource: validationProviderConfigOptionSourceSchema.optional(),
  showWhen: z
    .object({
      field: z.string(),
      exists: z.boolean().optional(),
      minItems: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const validationProviderRuleItemSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  inputHint: z.string(),
  inputPattern: z.string().optional(),
  patternTemplate: validationProviderPatternTemplateSchema.optional(),
  configFields: z.array(validationProviderConfigFieldSchema).optional(),
});

export const validationProviderItemSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  rules: z.array(validationProviderRuleItemSchema),
});

export const listValidationProvidersResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(validationProviderItemSchema),
});

export const getValidationProviderResponseSchema = z.object({
  success: z.literal(true),
  data: validationProviderItemSchema,
});

export type ValidationProviderItem = z.infer<
  typeof validationProviderItemSchema
>;
export type ValidationProviderRuleItem = z.infer<
  typeof validationProviderRuleItemSchema
>;
export type ValidationProviderPatternTemplate = z.infer<
  typeof validationProviderPatternTemplateSchema
>;
export type ValidationProviderConfigField = z.infer<
  typeof validationProviderConfigFieldSchema
>;
export type ListValidationProvidersResponse = z.infer<
  typeof listValidationProvidersResponseSchema
>;
export type GetValidationProviderResponse = z.infer<
  typeof getValidationProviderResponseSchema
>;

export function getValidationProviderByName(
  providers: readonly ValidationProviderItem[],
  providerName: string,
): ValidationProviderItem | undefined {
  return providers.find((provider) => provider.name === providerName);
}

export function getValidationProviderRule(
  providers: readonly ValidationProviderItem[],
  providerName: string,
  ruleType: string,
): ValidationProviderRuleItem | undefined {
  const provider = getValidationProviderByName(providers, providerName);
  return provider?.rules.find((rule) => rule.name === ruleType);
}
