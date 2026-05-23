import { z } from "zod";

/** Known `SystemSetting.key` values and their persisted JSON shapes. */
export const SYSTEM_SETTING_KEY = {
  SERVICES_DYNAMIC: "services.dynamic",
  SERVICES_CONFIG: "services.config",
} as const;

/** A persisted system-setting key. */
export const systemSettingKeySchema = z.enum([
  SYSTEM_SETTING_KEY.SERVICES_DYNAMIC,
  SYSTEM_SETTING_KEY.SERVICES_CONFIG,
]);

/** Persisted system-setting key type. */
export type SystemSettingKey = z.infer<typeof systemSettingKeySchema>;

/** One dynamic external service entry stored under `services.dynamic`. */
export const dynamicServiceEntrySchema = z.object({
  service: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string(),
});

/** Dynamic service entry type. */
export type DynamicServiceEntry = z.infer<typeof dynamicServiceEntrySchema>;

/** Maximum dynamic services entries allowed on write. */
export const SYSTEM_SETTING_DYNAMIC_SERVICES_MAX = 64;

/** Read schema for `services.dynamic` (no array cap; tolerates legacy rows). */
export const servicesDynamicSettingReadValueSchema = z.array(
  dynamicServiceEntrySchema,
);

/** Write schema for `services.dynamic`. */
export const servicesDynamicSettingWriteValueSchema =
  servicesDynamicSettingReadValueSchema.max(
    SYSTEM_SETTING_DYNAMIC_SERVICES_MAX,
  );

/** @deprecated Use `servicesDynamicSettingWriteValueSchema` for writes. */
export const servicesDynamicSettingValueSchema =
  servicesDynamicSettingWriteValueSchema;

/** Value schema for `services.config`. */
export const servicesConfigSettingValueSchema = z.record(
  z.string(),
  z.unknown(),
);

const systemSettingReadValueSchemas = {
  [SYSTEM_SETTING_KEY.SERVICES_DYNAMIC]: servicesDynamicSettingReadValueSchema,
  [SYSTEM_SETTING_KEY.SERVICES_CONFIG]: servicesConfigSettingValueSchema,
} as const satisfies Record<SystemSettingKey, z.ZodType>;

const systemSettingWriteValueSchemas = {
  [SYSTEM_SETTING_KEY.SERVICES_DYNAMIC]: servicesDynamicSettingWriteValueSchema,
  [SYSTEM_SETTING_KEY.SERVICES_CONFIG]: servicesConfigSettingValueSchema,
} as const satisfies Record<SystemSettingKey, z.ZodType>;

/** Parsed value type for a known system-setting key (read shape). */
export type SystemSettingValue<K extends SystemSettingKey> = z.infer<
  (typeof systemSettingReadValueSchemas)[K]
>;

/** Result of validating a system-setting write. */
export type SystemSettingWriteValidationResult =
  | {
      success: true;
      key: SystemSettingKey;
      value: z.infer<(typeof systemSettingWriteValueSchemas)[SystemSettingKey]>;
    }
  | { success: false; status: 400; error: string };

/** Result of parsing a stored system-setting row for API responses. */
export type SystemSettingReadParseResult =
  | {
      success: true;
      key: SystemSettingKey;
      value: SystemSettingValue<SystemSettingKey>;
    }
  | { success: false };

/**
 * Returns whether `key` is a known persisted system-setting key.
 */
export function isKnownSystemSettingKey(key: string): key is SystemSettingKey {
  return systemSettingKeySchema.safeParse(key).success;
}

/**
 * Validates a system-setting key/value pair before persistence.
 *
 * Unknown keys and malformed values return `{ success: false, status: 400 }`.
 */
export function validateSystemSettingWrite(
  key: string,
  value: unknown,
): SystemSettingWriteValidationResult {
  const keyResult = systemSettingKeySchema.safeParse(key);
  if (!keyResult.success) {
    return { success: false, status: 400, error: "Unknown system setting key" };
  }

  const valueResult =
    systemSettingWriteValueSchemas[keyResult.data].safeParse(value);
  if (!valueResult.success) {
    return {
      success: false,
      status: 400,
      error: "Invalid system setting value",
    };
  }

  return {
    success: true,
    key: keyResult.data,
    value: valueResult.data,
  };
}

/**
 * Parses a stored system-setting row using read-time schemas (no write caps).
 */
export function parseStoredSystemSettingRow(
  key: string,
  value: unknown,
): SystemSettingReadParseResult {
  const keyResult = systemSettingKeySchema.safeParse(key);
  if (!keyResult.success) {
    return { success: false };
  }

  const valueResult =
    systemSettingReadValueSchemas[keyResult.data].safeParse(value);
  if (!valueResult.success) {
    return { success: false };
  }

  return {
    success: true,
    key: keyResult.data,
    value: valueResult.data,
  };
}

/**
 * Parses a stored system-setting value for a known key.
 *
 * @returns Parsed value, or `fallback` when the row is missing or invalid.
 */
export function parseSystemSettingValue(
  key: typeof SYSTEM_SETTING_KEY.SERVICES_DYNAMIC,
  value: unknown,
  fallback: SystemSettingValue<typeof SYSTEM_SETTING_KEY.SERVICES_DYNAMIC>,
): SystemSettingValue<typeof SYSTEM_SETTING_KEY.SERVICES_DYNAMIC>;
export function parseSystemSettingValue(
  key: typeof SYSTEM_SETTING_KEY.SERVICES_CONFIG,
  value: unknown,
  fallback: SystemSettingValue<typeof SYSTEM_SETTING_KEY.SERVICES_CONFIG>,
): SystemSettingValue<typeof SYSTEM_SETTING_KEY.SERVICES_CONFIG>;
export function parseSystemSettingValue(
  key: SystemSettingKey,
  value: unknown,
  fallback: SystemSettingValue<SystemSettingKey>,
): SystemSettingValue<SystemSettingKey> {
  const result = systemSettingReadValueSchemas[key].safeParse(value);
  return result.success ? result.data : fallback;
}
