import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../../types/domain/form";
import { logWarn } from "../logger";

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
