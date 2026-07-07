import {
  isSafeFormAppearanceImageUrl,
  parseValidationOutputExportSettings,
  validationOutputExportSettingsSchema,
} from "@nexus-form/shared";
import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../../types/domain/form";
import { logWarn } from "../logger";

const LEGACY_APPEARANCE_IMAGE_URL_KEYS = [
  "logo_url",
  "cover_image_url",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Drop legacy empty logic rules that predate StoredLogicRuleSchema strictness. */
function normalizeLegacyStructure(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  let normalized = raw;

  if (Array.isArray(raw.logic)) {
    const normalizedLogic = raw.logic.filter((rule) => {
      if (!isRecord(rule)) return false;
      const condition = rule.condition;
      const action = rule.action;
      if (!isRecord(condition) || !isRecord(action)) return false;
      if (typeof condition.field !== "string" || condition.field.length === 0) {
        return false;
      }
      if (
        typeof condition.operator !== "string" ||
        condition.operator.length === 0
      ) {
        return false;
      }
      if (typeof action.type !== "string" || action.type.length === 0) {
        return false;
      }
      return true;
    });

    if (normalizedLogic.length !== raw.logic.length) {
      logWarn(
        `parseStoredStructure: dropped ${raw.logic.length - normalizedLogic.length} legacy logic rule(s)`,
        "general",
      );
      normalized = { ...normalized, logic: normalizedLogic };
    }
  }

  const settings = normalized.settings;
  if (isRecord(settings) && settings.validation_output_export !== undefined) {
    const validationOutputExportResult =
      validationOutputExportSettingsSchema.safeParse(
        settings.validation_output_export,
      );
    if (!validationOutputExportResult.success) {
      const normalizedValidationOutputExport =
        parseValidationOutputExportSettings(settings.validation_output_export);
      logWarn(
        "parseStoredStructure: normalized validation output export settings",
        "general",
      );
      normalized = {
        ...normalized,
        settings: {
          ...settings,
          validation_output_export: normalizedValidationOutputExport,
        },
      };
    }
  }

  const appearance = normalized.appearance;
  if (!isRecord(appearance)) {
    return normalized;
  }

  const theme = appearance.theme;
  if (!isRecord(theme)) {
    return normalized;
  }

  let normalizedTheme = theme;
  let droppedImageUrlCount = 0;
  for (const key of LEGACY_APPEARANCE_IMAGE_URL_KEYS) {
    const value = theme[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isSafeFormAppearanceImageUrl(value)) {
      if (normalizedTheme === theme) {
        normalizedTheme = { ...theme };
      }
      delete normalizedTheme[key];
      droppedImageUrlCount += 1;
    }
  }

  if (droppedImageUrlCount === 0) {
    return normalized;
  }

  logWarn(
    `parseStoredStructure: dropped ${droppedImageUrlCount} legacy appearance image URL(s)`,
    "general",
  );
  return {
    ...normalized,
    appearance: {
      ...appearance,
      theme: normalizedTheme,
    },
  };
}

/**
 * DB の structureJson をパースして返す。
 *
 * zod は未知のフィールドを strip するため、トップレベルに余剰キーが
 * あれば警告ログを出力し、呼び出し元がデータ欠損に気づけるようにする。
 * ※ ネストされたオブジェクト内の余剰キーは検出対象外。
 */
export function parseStoredStructure(json: string): FormStructureType {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("parseStoredStructure: invalid JSON in DB");
  }
  raw = normalizeLegacyStructure(raw);
  const result = FormStructure.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `parseStoredStructure: invalid structure in DB: ${JSON.stringify(result.error.issues.slice(0, 5))}`,
    );
  }
  const rawKeys = Object.keys(raw as Record<string, unknown>);
  const parsedKeys = Object.keys(result.data);
  const strippedKeys = rawKeys.filter((k) => !parsedKeys.includes(k));
  if (strippedKeys.length > 0) {
    logWarn(
      `parseStoredStructure: unknown fields stripped by schema: ${strippedKeys.join(", ")}`,
      "general",
    );
  }
  return result.data;
}
