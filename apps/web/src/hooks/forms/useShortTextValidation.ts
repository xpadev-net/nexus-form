import { useCallback, useEffect, useState } from "react";
import type { Block } from "@/types/domain/form-block";
import { validateShortText } from "@/utils/validation/question-validators";

/**
 * 短文テキスト入力のバリデーション用カスタムフック
 *
 * @param question - 質問の設定情報
 * @param value - 現在の入力値
 * @param debounceDelay - デバウンス遅延時間（ミリ秒）
 * @returns バリデーション状態と関数
 */
export const useShortTextValidation = (
  question: Block,
  value: string,
  debounceDelay: number = 300,
) => {
  const [localError, setLocalError] = useState<string | undefined>();
  const [isValidating, setIsValidating] = useState(false);

  /**
   * 入力値のバリデーションを実行
   *
   * @param inputValue - バリデーション対象の入力値
   * @returns バリデーション結果（isValid: boolean, error?: string）
   */
  const validateValue = useCallback(
    async (inputValue: string) => {
      if (!question.validation) return { isValid: true, error: undefined };

      setIsValidating(true);

      try {
        const response = {
          question_id: question.id,
          question_type: "short_text" as const,
          value: inputValue,
        };

        const result = validateShortText(question, response);

        if (!result.is_valid && result.errors.length > 0) {
          const firstError = result.errors[0];
          const errorMessage = firstError
            ? firstError.message
            : "バリデーションエラー";
          setLocalError(errorMessage);
          return { isValid: false, error: errorMessage };
        } else {
          setLocalError(undefined);
          return { isValid: true, error: undefined };
        }
      } catch {
        const errorMessage = "バリデーション中にエラーが発生しました";
        setLocalError(errorMessage);
        return { isValid: false, error: errorMessage };
      } finally {
        setIsValidating(false);
      }
    },
    [question],
  );

  // デバウンス処理用のuseEffect
  useEffect(() => {
    if (!question.validation) return;

    const timeoutId = setTimeout(() => {
      validateValue(value);
    }, debounceDelay);

    return () => clearTimeout(timeoutId);
  }, [value, validateValue, question.validation, debounceDelay]);

  return {
    localError,
    isValidating,
    validateValue,
  };
};
