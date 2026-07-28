export const FINGERPRINT_COMPONENT_KEY_SEPARATOR = ":";

function escapeFingerprintComponentPart(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export function buildFingerprintComponentKey(
  providerName: string,
  componentName: string,
): string {
  return `${escapeFingerprintComponentPart(providerName)}${FINGERPRINT_COMPONENT_KEY_SEPARATOR}${escapeFingerprintComponentPart(
    componentName,
  )}`;
}
