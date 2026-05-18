/**
 * Builds a whitelist-filtered structure object safe for public form responses.
 * Only includes fields needed by the public form UI, excluding sensitive
 * internal data such as notifications and access_control.
 *
 * All nested objects are deep-copied so that callers cannot mutate the
 * original structure through the returned value.
 */

/** Settings sub-fields safe to expose in the public API response. */
const PUBLIC_SETTINGS_KEYS = [
  "allow_edit_responses",
  "require_fingerprint",
  "response_limit",
  "privacy_notice",
  "schedule",
  "autosave",
] as const;

function safeDeepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

interface PublicFormStructure {
  version?: number;
  settings?: Record<string, unknown>;
  logic?: unknown[];
  appearance?: unknown;
  confirmation?: unknown;
}

function pickPublicSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_SETTINGS_KEYS) {
    if (settings[key] !== undefined) {
      result[key] = safeDeepClone(settings[key]);
    }
  }
  return result;
}

export function buildPublicFormStructure(
  structure: Record<string, unknown>,
): PublicFormStructure {
  const result: PublicFormStructure = {};

  if (typeof structure.version === "number") {
    result.version = structure.version;
  }
  if (structure.settings != null && typeof structure.settings === "object") {
    result.settings = pickPublicSettings(
      structure.settings as Record<string, unknown>,
    );
  }
  // logic rules are fully exposed for client-side condition evaluation.
  // Review any future schema additions for sensitivity before merging.
  if (Array.isArray(structure.logic)) {
    result.logic = safeDeepClone(structure.logic) as unknown[];
  }
  if (structure.appearance != null) {
    result.appearance = safeDeepClone(structure.appearance);
  }
  if (structure.confirmation != null) {
    result.confirmation = safeDeepClone(structure.confirmation);
  }

  return result;
}
