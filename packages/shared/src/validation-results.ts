import { z } from "zod";

export const VALIDATION_OUTPUT_METADATA_KEY = "validationOutputs";

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
  const parsedOutputValues = validationOutputValuesSchema.parse(outputValues);
  return {
    ...(metadata ?? {}),
    [VALIDATION_OUTPUT_METADATA_KEY]: parsedOutputValues,
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
