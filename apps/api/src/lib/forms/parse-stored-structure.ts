import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../../types/domain/form";
import { logWarn } from "../logger";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Drop legacy empty logic rules that predate StoredLogicRuleSchema strictness. */
function normalizeLegacyStructure(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.logic)) {
    return raw;
  }

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

  if (normalizedLogic.length === raw.logic.length) {
    return raw;
  }

  logWarn(
    `parseStoredStructure: dropped ${raw.logic.length - normalizedLogic.length} legacy logic rule(s)`,
    "general",
  );
  return { ...raw, logic: normalizedLogic };
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
