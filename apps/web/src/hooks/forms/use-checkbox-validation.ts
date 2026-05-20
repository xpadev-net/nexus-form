import { useMemo } from "react";
import type { CheckboxValidationConfig } from "@/types/domain/form-block";

/**
 * チェックボックスのバリデーションロジックを管理するフック
 *
 * @param value - 現在の選択値の配列
 * @param validation - バリデーション設定
 * @returns バリデーション結果とエラーメッセージ
 */
export const useCheckboxValidation = (
  value: string[],
  validation: CheckboxValidationConfig,
) => {
  return useMemo(() => {
    const count = value.length;
    const { minSelections, maxSelections } = validation;

    // 最小選択数のチェック
    if (minSelections && count < minSelections) {
      return {
        isValid: false,
        errorMessage: `最低${minSelections}個の選択が必要です（現在: ${count}個）`,
      };
    }

    // 最大選択数のチェック
    if (maxSelections && count > maxSelections) {
      return {
        isValid: false,
        errorMessage: `最大${maxSelections}個まで選択できます（現在: ${count}個）`,
      };
    }

    return {
      isValid: true,
      errorMessage: null,
    };
  }, [
    value.length,
    validation.minSelections,
    validation.maxSelections,
    validation,
  ]);
};
