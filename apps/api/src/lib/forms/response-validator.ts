import type { ResponseDataItem, ValidatorQuestion } from "@nexus-form/shared";
import safeRegex from "safe-regex2";

import { logError, logWarn } from "../logger";

/**
 * Minimal FormStructure type for this validator.
 */
interface FormStructure {
  version: number;
  settings: Record<string, unknown>;
  questions?: ValidatorQuestion[];
  [key: string]: unknown;
}

function isSafeRegex(pattern: string): boolean {
  try {
    return safeRegex(pattern);
  } catch {
    return false;
  }
}

/**
 * 回答データをバリデーションする
 * @param responses 回答データ
 * @param formStructure フォーム構造
 * @returns バリデーション結果
 */
export function validateResponseData(
  responses: unknown[],
  formStructure: FormStructure | null | undefined,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!formStructure) {
    errors.push("Invalid form structure");
    return { isValid: false, errors };
  }

  const questions = Array.isArray(formStructure.questions)
    ? formStructure.questions
    : [];

  // 基本的な回答データの検証
  // ロジック分岐で全ページがスキップされた場合、空配列は正当な送信となる。
  if (!responses) {
    errors.push("No response data provided");
    return { isValid: false, errors };
  }

  // 各回答の基本バリデーション
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i] as ResponseDataItem | undefined;

    if (!response || typeof response !== "object") {
      errors.push(`Response ${i + 1}: Invalid response format`);
      continue;
    }

    // 基本的な必須フィールドチェック
    if (!response.question_id) {
      errors.push(`Response ${i + 1}: Question ID is required`);
      continue;
    }

    const question = questions.find((q) => q.id === response.question_id);
    const isRequired = question?.validation?.required ?? false;

    // 質問タイプごとの値チェック
    switch (response.question_type) {
      case "short_text":
      case "long_text":
        if (
          response.value !== undefined &&
          response.value !== null &&
          typeof response.value !== "string"
        ) {
          errors.push(
            `Response ${i + 1}: Text value must be a string for question ${response.question_id}`,
          );
        } else if (
          isRequired &&
          (response.value === undefined ||
            response.value === null ||
            typeof response.value !== "string" ||
            response.value.trim() === "")
        ) {
          errors.push(
            `Response ${i + 1}: Text value is required for question ${response.question_id}`,
          );
        }
        break;
      case "radio":
      case "dropdown":
        if (
          response.value !== undefined &&
          response.value !== null &&
          typeof response.value !== "string"
        ) {
          errors.push(
            `Response ${i + 1}: Selection value must be a string for question ${response.question_id}`,
          );
        } else if (
          isRequired &&
          (response.value === undefined ||
            response.value === null ||
            (typeof response.value === "string" &&
              response.value.trim() === ""))
        ) {
          errors.push(
            `Response ${i + 1}: Selection value is required for question ${response.question_id}`,
          );
        }
        if (
          question?.validation?.options &&
          response.value !== undefined &&
          response.value !== null &&
          typeof response.value === "string" &&
          response.value !== ""
        ) {
          if (response.value === "other" && !question.validation.allowOther) {
            errors.push(
              `Response ${i + 1}: "other" is not an allowed option for question ${response.question_id}`,
            );
          } else if (
            response.value !== "other" &&
            !question.validation.options.some((o) => o.id === response.value)
          ) {
            errors.push(
              `Response ${i + 1}: Value is not a valid option for question ${response.question_id}`,
            );
          }
        }
        // "other" 選択時は other_value テキストが必須 (question メタデータ不要)
        // ただし allowOther=false で既に「"other" は不正」エラーが出ている場合は重複を避ける
        if (
          response.value === "other" &&
          question?.validation?.allowOther !== false &&
          (!response.other_value || response.other_value.trim() === "")
        ) {
          errors.push(
            `Response ${i + 1}: Other value text is required when "other" is selected for question ${response.question_id}`,
          );
        }
        break;
      case "checkbox":
        if (isRequired && (!response.values || response.values.length === 0)) {
          errors.push(
            `Response ${i + 1}: At least one selection is required for question ${response.question_id}`,
          );
        }
        if (
          question?.validation?.options &&
          Array.isArray(response.values) &&
          response.values.length > 0
        ) {
          if (
            !question.validation.allowOther &&
            response.values.includes("other")
          ) {
            errors.push(
              `Response ${i + 1}: "other" is not an allowed option for question ${response.question_id}`,
            );
          }
          const validIds = new Set(
            question.validation.options.map((o) => o.id),
          );
          for (const val of response.values) {
            if (typeof val !== "string") {
              errors.push(
                `Response ${i + 1}: Checkbox values must be strings for question ${response.question_id}`,
              );
              break;
            }
            if (val !== "other" && !validIds.has(val)) {
              errors.push(
                `Response ${i + 1}: Value "${val}" is not a valid option for question ${response.question_id}`,
              );
              break;
            }
          }
        }
        // "other" 選択時は other_values テキストが必須 (question メタデータ不要)
        // ただし allowOther=false で既に「"other" は不正」エラーが出ている場合は重複を避ける
        if (
          Array.isArray(response.values) &&
          response.values.includes("other") &&
          question?.validation?.allowOther !== false &&
          (!response.other_values ||
            response.other_values.length === 0 ||
            response.other_values.every((v) => v.trim() === ""))
        ) {
          errors.push(
            `Response ${i + 1}: Other value text is required when "other" is selected for question ${response.question_id}`,
          );
        }
        break;
      case "linear_scale":
      case "rating": {
        const numVal = response.value;
        const isEmpty =
          numVal === undefined ||
          numVal === null ||
          (typeof numVal === "string" && numVal.trim() === "");
        if (isRequired && isEmpty) {
          errors.push(
            `Response ${i + 1}: Numeric value is required for question ${response.question_id}`,
          );
        } else if (!isEmpty) {
          const isNumeric =
            typeof numVal === "number"
              ? Number.isFinite(numVal)
              : typeof numVal === "string" &&
                Number.isFinite(Number(numVal.trim()));
          if (!isNumeric) {
            errors.push(
              `Response ${i + 1}: Numeric value is invalid for question ${response.question_id}`,
            );
            // linear_scale allows non-integer values (e.g. 4.5 for slider-style fields);
            // only rating questions enforce integer-only values.
          } else if (response.question_type === "rating") {
            const parsed = typeof numVal === "number" ? numVal : Number(numVal);
            if (!Number.isInteger(parsed)) {
              errors.push(
                `Response ${i + 1}: Rating value must be an integer for question ${response.question_id}`,
              );
            }
          }
        }
        break;
      }
      case "choice_grid":
      case "checkbox_grid":
        if (
          isRequired &&
          (!response.responses || Object.keys(response.responses).length === 0)
        ) {
          errors.push(
            `Response ${i + 1}: Grid responses are required for question ${response.question_id}`,
          );
        }
        if (response.responses) {
          for (const [rowId, value] of Object.entries(response.responses)) {
            if (
              response.question_type === "choice_grid" &&
              typeof value !== "string"
            ) {
              errors.push(
                `Response ${i + 1}: Choice grid row ${rowId} must contain a single selection for question ${response.question_id}`,
              );
            }
            if (
              response.question_type === "checkbox_grid" &&
              !Array.isArray(value)
            ) {
              errors.push(
                `Response ${i + 1}: Checkbox grid row ${rowId} must contain selection arrays for question ${response.question_id}`,
              );
            }
          }
        }
        break;
      case "date":
      case "time":
        if (
          response.value !== undefined &&
          response.value !== null &&
          typeof response.value !== "string"
        ) {
          errors.push(
            `Response ${i + 1}: Date/time value must be a string for question ${response.question_id}`,
          );
        } else if (
          isRequired &&
          (response.value === undefined ||
            response.value === null ||
            (typeof response.value === "string" &&
              response.value.trim() === ""))
        ) {
          errors.push(
            `Response ${i + 1}: Date/time value is required for question ${response.question_id}`,
          );
        }
        break;
      default:
        // 未知タイプの報告は第二ループ（質問定義との整合性チェック）に委譲する。
        // question が見つかった場合は型不一致エラーが第2ループで出るため、
        // 非プリミティブ値チェックは question 未定義時のみ発動させて重複エラーを避ける。
        if (
          !question &&
          response.value !== undefined &&
          response.value !== null &&
          typeof response.value === "object"
        ) {
          errors.push(
            `Response ${i + 1}: Non-primitive value is not allowed for question ${response.question_id}`,
          );
        }
        break;
    }
  }

  if (questions.length === 0 && responses.length > 0) {
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i] as ResponseDataItem | undefined;
      if (response?.question_id) {
        errors.push(
          `Response ${i + 1}: Unknown question ID ${response.question_id}`,
        );
      }
    }
  }

  // フォーム構造から質問情報を取得して詳細バリデーション
  if (questions.length > 0) {
    // NOTE: ロジック分岐によりスキップされたページの必須質問には回答が送信されないため、
    // 「全必須質問に回答があるか」のチェックは行わない。
    // 送信された個々の回答に対する必須チェックは上の switch 文で実施済み。

    // 質問タイプと回答タイプの整合性チェック
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i] as ResponseDataItem | undefined;
      if (response?.question_id && response.question_type) {
        const question = questions.find((q) => q.id === response.question_id);

        if (!question) {
          errors.push(
            `Response ${i + 1}: Unknown question ID ${response.question_id}`,
          );
        } else if (question.type !== response.question_type) {
          errors.push(
            `Response ${i + 1}: Question type mismatch for question ${response.question_id}. Expected ${question.type}, got ${response.question_type}`,
          );
        }
      }
    }

    // チェックボックスの選択数制限チェック
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i] as ResponseDataItem | undefined;
      if (!response) continue;
      const question = questions.find((q) => q.id === response.question_id);
      if (!question?.validation) continue;

      if (response.question_type === "checkbox" && response.values) {
        const { minSelections, maxSelections } = question.validation;
        const count = response.values.length;
        // For non-required checkboxes, an empty selection is equivalent to no answer.
        // For required checkboxes, the top-level required check above already
        // reported the error when count === 0.
        if (count === 0) continue;
        if (minSelections != null && count < minSelections) {
          errors.push(
            `Response ${i + 1}: At least ${minSelections} selection(s) required for question ${response.question_id}`,
          );
        }
        if (maxSelections != null && count > maxSelections) {
          errors.push(
            `Response ${i + 1}: At most ${maxSelections} selection(s) allowed for question ${response.question_id}`,
          );
        }
      }

      if (response.question_type === "choice_grid") {
        const { rows } = question.validation;
        const isGridRequired = question.validation.required === true;
        const expectedRows = rows ?? [];
        const hasAnyResponse =
          response.responses && Object.keys(response.responses).length > 0;
        if (isGridRequired && hasAnyResponse) {
          for (const row of expectedRows) {
            const rowTouched =
              response.responses != null && row.id in response.responses;
            const value = response.responses?.[row.id];
            if (!rowTouched || typeof value !== "string" || value === "") {
              errors.push(
                `Response ${i + 1}: Row ${row.id} requires a selection for question ${response.question_id}`,
              );
            }
          }
        }
      }

      if (response.question_type === "checkbox_grid") {
        const { minSelectionsPerRow, maxSelectionsPerRow, rows } =
          question.validation;
        const isGridRequired = question.validation.required === true;
        const expectedRows = rows ?? [];
        const hasAnyResponse =
          response.responses && Object.keys(response.responses).length > 0;
        if (
          (minSelectionsPerRow != null || maxSelectionsPerRow != null) &&
          expectedRows.length === 0
        ) {
          logError(
            `checkbox_grid question ${question.id} has row-level selection limits but no rows metadata`,
            "validation",
            { questionId: question.id },
          );
        }
        if (!hasAnyResponse && !isGridRequired) {
          // untouched optional grid: nothing to validate at grid level
        } else if (
          !(isGridRequired && !hasAnyResponse && minSelectionsPerRow != null)
        ) {
          for (const row of expectedRows) {
            const rawCols = response.responses?.[row.id];
            const cols = Array.isArray(rawCols) ? rawCols : [];
            const count = cols.length;
            // For non-required fields, only validate rows the respondent actually interacted with
            const rowTouched =
              response.responses != null && row.id in response.responses;
            if (!isGridRequired && !rowTouched) continue;
            // For required grids that are completely empty, the grid-level error
            // ("Grid responses are required ...") has already been added above.
            // Avoid adding one error per row in that case.
            if (isGridRequired && !hasAnyResponse) continue;
            if (isGridRequired && count === 0 && minSelectionsPerRow == null) {
              errors.push(
                `Response ${i + 1}: Row ${row.id} requires a selection for question ${response.question_id}`,
              );
              continue;
            }
            if (minSelectionsPerRow != null && count < minSelectionsPerRow) {
              errors.push(
                `Response ${i + 1}: Row ${row.id} requires at least ${minSelectionsPerRow} selection(s) for question ${response.question_id}`,
              );
            }
            if (maxSelectionsPerRow != null && count > maxSelectionsPerRow) {
              errors.push(
                `Response ${i + 1}: Row ${row.id} allows at most ${maxSelectionsPerRow} selection(s) for question ${response.question_id}`,
              );
            }
          }
        }
      }

      // テキスト長制限チェック
      if (
        (response.question_type === "short_text" ||
          response.question_type === "long_text") &&
        typeof response.value === "string" &&
        response.value !== ""
      ) {
        const { minLength, maxLength } = question.validation;
        const len = response.value.length;
        if (minLength != null && len < minLength) {
          errors.push(
            `Response ${i + 1}: Text must be at least ${minLength} character(s) for question ${response.question_id}`,
          );
        }
        if (maxLength != null && len > maxLength) {
          errors.push(
            `Response ${i + 1}: Text must be at most ${maxLength} character(s) for question ${response.question_id}`,
          );
        }
      }

      // 数値範囲チェック (linear_scale / rating)
      if (
        (response.question_type === "linear_scale" ||
          response.question_type === "rating") &&
        response.value !== undefined &&
        response.value !== null
      ) {
        const numVal = response.value;
        const parsed =
          typeof numVal === "number"
            ? numVal
            : typeof numVal === "string"
              ? Number(numVal.trim())
              : Number.NaN;
        if (Number.isFinite(parsed)) {
          const { min, max } = question.validation;
          if (min != null && parsed < min) {
            errors.push(
              `Response ${i + 1}: Value must be at least ${min} for question ${response.question_id}`,
            );
          }
          if (max != null && parsed > max) {
            errors.push(
              `Response ${i + 1}: Value must be at most ${max} for question ${response.question_id}`,
            );
          }
        }
      }

      // 正規表現パターンチェック（allowPatternMismatch が true の場合はスキップ）
      if (
        response.question_type === "short_text" &&
        typeof response.value === "string" &&
        response.value !== "" &&
        question.validation.pattern &&
        !question.validation.allowPatternMismatch
      ) {
        try {
          if (!isSafeRegex(question.validation.pattern)) {
            logWarn(
              `Skipping unsafe regex pattern for question ${question.id}: ${question.validation.pattern}`,
              "validation",
              { questionId: question.id },
            );
          } else {
            const re = new RegExp(question.validation.pattern);
            if (!re.test(response.value)) {
              errors.push(
                `Response ${i + 1}: Value does not match the required pattern for question ${response.question_id}`,
              );
            }
          }
        } catch {
          // invalid regex in form config — skip pattern check
        }
      }

      // 日付範囲チェック
      if (
        response.question_type === "date" &&
        typeof response.value === "string" &&
        response.value !== ""
      ) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(response.value)) {
          errors.push(
            `Response ${i + 1}: Invalid date format for question ${response.question_id}`,
          );
        } else {
          const { minDate, maxDate } = question.validation;
          if (minDate && response.value < minDate) {
            errors.push(
              `Response ${i + 1}: Date must be on or after ${minDate} for question ${response.question_id}`,
            );
          }
          if (maxDate && response.value > maxDate) {
            errors.push(
              `Response ${i + 1}: Date must be on or before ${maxDate} for question ${response.question_id}`,
            );
          }
        }
      }

      // 時刻範囲チェック
      if (
        response.question_type === "time" &&
        typeof response.value === "string" &&
        response.value !== ""
      ) {
        if (!/^\d{2}:\d{2}$/.test(response.value)) {
          errors.push(
            `Response ${i + 1}: Invalid time format for question ${response.question_id}`,
          );
        } else {
          const { minTime, maxTime } = question.validation;
          if (minTime && response.value < minTime) {
            errors.push(
              `Response ${i + 1}: Time must be on or after ${minTime} for question ${response.question_id}`,
            );
          }
          if (maxTime && response.value > maxTime) {
            errors.push(
              `Response ${i + 1}: Time must be on or before ${maxTime} for question ${response.question_id}`,
            );
          }
        }
      }

      // NOTE: "other" 回答の other_value/other_values テキスト必須チェックは
      // 第1ループの switch 内で実施済み (question メタデータ不要のため)。
    }
  }

  return { isValid: errors.length === 0, errors };
}
