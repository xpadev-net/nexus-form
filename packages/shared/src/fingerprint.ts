import { z } from "zod";

/**
 * Separator used to build provider-qualified fingerprint component keys.
 *
 * Keys are normalized as `<provider>:<component>`, with `:` and `\` escaped
 * inside each part so the resulting key is stable and collision-resistant.
 */
export const FINGERPRINT_COMPONENT_KEY_SEPARATOR = ":";

/** Max length of a single fingerprint component name/value hash field. */
export const MAX_FINGERPRINT_FIELD_LENGTH = 256;

/**
 * Max number of client-collected fingerprint components accepted per public
 * form submission. This is informational data supplementing the
 * security-exchange-verified evidence, so it is capped defensively rather
 * than tied to the security plan's fixed component set.
 */
export const MAX_REPORTED_FINGERPRINTS = 200;

/**
 * A single client-collected fingerprint component reported alongside a
 * public form submission. Unlike the security-exchange evidence, these are
 * not cryptographically tied to a server-issued plan; they are stored for
 * uniqueness scoring and analytics only.
 */
export const reportedFingerprintEntrySchema = z.object({
  type: z.enum(["fingerprintjs", "thumbmarkjs", "browser"]),
  name: z.string().min(1).max(MAX_FINGERPRINT_FIELD_LENGTH),
  value_hash: z.string().min(1).max(MAX_FINGERPRINT_FIELD_LENGTH),
});

export type ReportedFingerprintEntry = z.infer<
  typeof reportedFingerprintEntrySchema
>;

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
