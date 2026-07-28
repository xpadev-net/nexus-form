/**
 * Separator used to build provider-qualified fingerprint component keys.
 *
 * Keys are normalized as `<provider>:<component>`, with `:` and `\` escaped
 * inside each part so the resulting key is stable and collision-resistant.
 */
export const FINGERPRINT_COMPONENT_KEY_SEPARATOR = ":";

function escapeFingerprintComponentPart(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

/**
 * Build a normalized fingerprint component key in `<provider>:<component>`
 * form.
 *
 * Both parts are escaped so literal `:` becomes `\:` and literal `\`
 * becomes `\\` before joining them with `FINGERPRINT_COMPONENT_KEY_SEPARATOR`.
 */
export function buildFingerprintComponentKey(
  providerName: string,
  componentName: string,
): string {
  return `${escapeFingerprintComponentPart(providerName)}${FINGERPRINT_COMPONENT_KEY_SEPARATOR}${escapeFingerprintComponentPart(
    componentName,
  )}`;
}
