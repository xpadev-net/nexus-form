import { z } from "zod";

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
