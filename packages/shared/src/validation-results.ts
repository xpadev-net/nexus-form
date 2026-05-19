export interface ValidationResultIdentity {
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
}

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

export function getValidationResultId(
  params: ValidationResultIdentity,
): string {
  return `validation-result:${hashValidationResultIdentity(params)}`;
}
