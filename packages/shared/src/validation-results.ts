import { z } from "zod";

export const VALIDATION_OUTPUT_METADATA_KEY = "validationOutputs";
export const VALIDATION_OUTPUT_EXPORT_SETTINGS_MAX_VALUES = 1000;

export const validationOutputKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

export const validationOutputScalarValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const validationOutputValueSchema = z
  .object({
    key: validationOutputKeySchema,
    label: z.string().min(1).max(120).optional(),
    value: validationOutputScalarValueSchema,
  })
  .strict();

export const validationOutputValuesSchema = z
  .array(validationOutputValueSchema)
  .superRefine((values, ctx) => {
    const seenKeys = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seenKeys.has(value.key)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate validation output key: ${value.key}`,
          path: [index, "key"],
        });
      }
      seenKeys.add(value.key);
    }
  });

const validationOutputMetadataSchema = z
  .object({
    [VALIDATION_OUTPUT_METADATA_KEY]: validationOutputValuesSchema.optional(),
  })
  .passthrough();

export type ValidationOutputValue = z.infer<typeof validationOutputValueSchema>;

export const validationOutputExportSettingSchema = z
  .object({
    rule_id: z.string().min(1).max(128),
    provider_name: z.string().min(1).max(64),
    rule_type: z.string().min(1).max(64),
    output_key: validationOutputKeySchema,
    enabled: z.boolean(),
  })
  .strict();

export const validationOutputExportSettingsSchema = z
  .object({
    values: z
      .array(validationOutputExportSettingSchema)
      .max(VALIDATION_OUTPUT_EXPORT_SETTINGS_MAX_VALUES)
      .default([]),
  })
  .strict()
  .superRefine((settings, ctx) => {
    const seenKeys = new Set<string>();
    for (const [index, value] of settings.values.entries()) {
      const key = `${value.rule_id}:${value.output_key}`;
      if (seenKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate validation output export setting: ${key}`,
          path: ["values", index, "output_key"],
        });
      }
      seenKeys.add(key);
    }
  });

export type ValidationOutputExportSetting = z.infer<
  typeof validationOutputExportSettingSchema
>;
export type ValidationOutputExportSettings = z.infer<
  typeof validationOutputExportSettingsSchema
>;

export function parseValidationOutputExportSettings(
  settings: unknown,
): ValidationOutputExportSettings {
  const parsed = validationOutputExportSettingsSchema.safeParse(settings);
  if (parsed.success) return parsed.data;

  if (
    settings === null ||
    typeof settings !== "object" ||
    !("values" in settings) ||
    !Array.isArray(settings.values)
  ) {
    return { values: [] };
  }

  const validValues: ValidationOutputExportSetting[] = [];
  const seenKeys = new Set<string>();
  for (const value of settings.values) {
    if (validValues.length >= VALIDATION_OUTPUT_EXPORT_SETTINGS_MAX_VALUES) {
      break;
    }
    const parsedValue = validationOutputExportSettingSchema.safeParse(value);
    if (!parsedValue.success) continue;
    const key = `${parsedValue.data.rule_id}:${parsedValue.data.output_key}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    validValues.push(parsedValue.data);
  }
  return { values: validValues };
}

/**
 * Runtime contract for the unique identity of an external validation result.
 */
export const validationResultIdentitySchema = z.object({
  responseId: z.string().min(1),
  ruleId: z.string().min(1),
  referencedBlockId: z.string().min(1),
});

/**
 * Unique identity fields used to derive a stable external validation result ID.
 */
export type ValidationResultIdentity = z.infer<
  typeof validationResultIdentitySchema
>;

const FNV_128_OFFSET_BASIS = 0x6c62272e07bb014262b821756295c58dn;
const FNV_128_PRIME = 0x0000000001000000000000000000013bn;
const FNV_128_MASK = (1n << 128n) - 1n;

function hashValidationResultIdentity(
  params: ValidationResultIdentity,
): string {
  const input = JSON.stringify([
    params.responseId,
    params.ruleId,
    params.referencedBlockId,
  ]);
  const inputBytes = new TextEncoder().encode(input);
  let hash = FNV_128_OFFSET_BASIS;

  for (const byte of inputBytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_128_PRIME) & FNV_128_MASK;
  }

  return hash.toString(16).padStart(32, "0");
}

/**
 * Derives a stable validation result ID from a validated
 * {@link validationResultIdentitySchema} payload.
 */
export function getValidationResultId(
  params: ValidationResultIdentity,
): string {
  const identity = validationResultIdentitySchema.parse(params);
  return `validation-result:${hashValidationResultIdentity(identity)}`;
}

export function mergeValidationOutputValuesIntoMetadata(
  metadata: Record<string, unknown> | undefined,
  outputValues: readonly ValidationOutputValue[] | undefined,
): Record<string, unknown> | undefined {
  if (outputValues === undefined) return metadata;
  const parsedOutputValues =
    validationOutputValuesSchema.safeParse(outputValues);
  if (!parsedOutputValues.success) return metadata;
  return {
    ...(metadata ?? {}),
    [VALIDATION_OUTPUT_METADATA_KEY]: parsedOutputValues.data,
  };
}

export function parseValidationOutputValuesFromMetadata(
  metadata: unknown,
): ValidationOutputValue[] {
  const parsed = validationOutputMetadataSchema.safeParse(metadata);
  return parsed.success
    ? (parsed.data[VALIDATION_OUTPUT_METADATA_KEY] ?? [])
    : [];
}
