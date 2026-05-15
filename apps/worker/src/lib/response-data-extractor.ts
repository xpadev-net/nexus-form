/**
 * レスポンスデータからの値抽出ユーティリティ。
 * DB 依存なしの純粋関数のみを含む。
 */

import {
  type ResponseDataItem,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { z } from "zod";

/**
 * レスポンスデータからブロックの値を抽出する。
 * responseData は ResponseDataItem[] 形式を期待する。
 */
export function extractReferencedValue(
  responseData: ResponseDataItem[],
  referencedBlockId: string,
): string {
  // 呼び出し元が JSON.parse 結果を as キャストしているため防御的にチェック
  const item = responseData.find(
    (r) =>
      r != null &&
      typeof r === "object" &&
      typeof r.question_id === "string" &&
      typeof r.question_type === "string" &&
      r.question_id === referencedBlockId,
  );
  if (!item) {
    throw new Error(`Referenced block value not found: ${referencedBlockId}`);
  }
  // 防御的ガード: 呼び出し元が JSON.parse 結果を as キャストしているため、
  // TypeScript の型だけではランタイムのプリミティブ制約を保証できない。
  if (Array.isArray(item.values) && item.values.length > 0) {
    if (
      item.values.some(
        (v) =>
          typeof v !== "string" &&
          typeof v !== "number" &&
          typeof v !== "boolean",
      )
    ) {
      throw new Error(
        `Referenced block values contain non-primitive items: ${referencedBlockId}`,
      );
    }
    const stringValues = item.values.map(String);
    // カンマを含む値があると join 結果が曖昧になるため拒否する
    if (stringValues.some((v) => v.includes(","))) {
      throw new Error(
        `Referenced block values contain comma characters that would produce ambiguous joined output: ${referencedBlockId}`,
      );
    }
  }
  // other_values もカンマチェック（checkbox の "other" 自由記述がカンマを含むと join 後に曖昧になる）
  // values に "other" センチネルが含まれる場合のみ other_values が実際に使用されるため、そのケースのみガードする
  if (
    item.question_type === "checkbox" &&
    Array.isArray(item.values) &&
    item.values.length > 0 &&
    item.values.some((v) => String(v) === "other") &&
    item.other_values?.some((v) => v.includes(","))
  ) {
    throw new Error(
      `Referenced block other_values contain comma characters that would produce ambiguous joined output: ${referencedBlockId}`,
    );
  }

  const value = extractValueFromItem(item);
  if (value === "") {
    throw new Error(`Referenced block value is empty: ${referencedBlockId}`);
  }
  return value;
}

/**
 * ResponseDataItem から値を文字列として抽出する。
 */
export function extractValueFromItem(item: ResponseDataItem): string {
  // 複数値 (checkbox) — values を value より優先する
  if (Array.isArray(item.values) && item.values.length > 0) {
    // "other" 選択肢の自由記述テキストで置換 (checkbox のみ)
    const otherValues =
      item.question_type === "checkbox" ? item.other_values : undefined;
    if (otherValues && otherValues.length > 0) {
      let otherIdx = 0;
      return item.values
        .map((v) => {
          if (String(v) === "other" && otherIdx < otherValues.length) {
            return otherValues[otherIdx++];
          }
          return String(v);
        })
        .join(",");
    }
    return item.values.map(String).join(",");
  }
  // 単一値 (short_text, long_text, radio, dropdown, date, time, linear_scale, rating)
  if (item.value !== undefined && item.value !== null) {
    const raw =
      typeof item.value === "string" ? item.value : String(item.value);
    // "other" 選択時は実際の自由記述テキストを返す (radio/dropdown のみ)
    const supportsOther =
      item.question_type === "radio" || item.question_type === "dropdown";
    if (raw === "other" && supportsOther && item.other_value)
      return item.other_value;
    return raw;
  }
  // 空の values 配列は未選択と同等
  if (Array.isArray(item.values)) {
    return "";
  }
  // グリッド形式 (choice_grid, checkbox_grid)
  if (item.responses !== undefined && item.responses !== null) {
    return Object.keys(item.responses).length === 0
      ? ""
      : JSON.stringify(item.responses);
  }
  // 未回答: value/values/responses がすべて未設定 — 空文字列を返す
  return "";
}

/**
 * JSON 文字列から referenced block の値を抽出する。
 * responseDataJson は ResponseDataItem[] 形式のみをサポートする。
 */
export function extractReferencedValueFromJson(
  responseDataJson: string,
  referencedBlockId: string,
  responseId: string,
): string {
  let rawData: unknown;
  try {
    rawData = JSON.parse(responseDataJson);
  } catch (e) {
    throw new Error(
      `responseDataJson is not valid JSON for response ${responseId}: ${String(e)}`,
    );
  }

  if (!Array.isArray(rawData)) {
    throw new Error(
      `Invalid responseDataJson format for response ${responseId}`,
    );
  }

  const parseResult = z.array(responsePayloadItemSchema).safeParse(rawData);
  if (!parseResult.success) {
    throw new Error(
      `responseDataJson array items failed schema validation for response ${responseId}: ${parseResult.error.message}`,
    );
  }

  return extractReferencedValue(parseResult.data, referencedBlockId);
}

/**
 * responseDataJson を安全にパースする。
 *
 * パース不能・オブジェクト/配列でない場合は警告ログを出して `null` を返す。
 * Sheets 同期のバッチ処理で 1 件の不正データが全体を巻き込まないよう、
 * 呼び出し元は `null` の場合に該当レスポンスをスキップする。
 *
 * 既存挙動（`JSON.parse(...) as Record<string, unknown>`）を保つため、
 * オブジェクトであれば配列も含めてそのまま返す。
 */
export function safeParseResponseData(
  responseDataJson: string,
  responseId: string,
): Record<string, unknown> | null {
  let rawData: unknown;
  try {
    rawData = JSON.parse(responseDataJson);
  } catch (e) {
    console.warn(
      `[response-data] Skipping response ${responseId}: invalid JSON -`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }

  if (rawData === null || typeof rawData !== "object") {
    console.warn(
      `[response-data] Skipping response ${responseId}: payload is not an object`,
    );
    return null;
  }
  return rawData as Record<string, unknown>;
}
