import type { Block } from "@/types/domain/form-block";

type QuestionWithOtherOption = Block;

/**
 * その他の選択肢に関する共通ロジックを管理するフック
 *
 * @param question - 質問オブジェクト
 * @param value - 現在の選択値（文字列または文字列配列）
 * @returns その他の選択肢に関する状態とヘルパー関数
 */
export const useOtherOption = (
  question: QuestionWithOtherOption,
  value: string | string[],
) => {
  const hasOtherOption =
    question.type === "radio" || question.type === "checkbox"
      ? (question.validation as { allowOther?: boolean }).allowOther || false
      : false;
  const isOtherSelected = Array.isArray(value)
    ? value.includes("other")
    : value === "other";

  return {
    hasOtherOption,
    isOtherSelected,
  };
};
