import { useCallback } from "react";

interface ValidationMessages {
  required: string;
  minLength: (min: number) => string;
  maxLength: (max: number) => string;
  validationError: string;
}

const DEFAULT_MESSAGES: ValidationMessages = {
  required: "この項目は必須です",
  minLength: (min: number) => `${min}文字以上で入力してください`,
  maxLength: (max: number) => `${max}文字以下で入力してください`,
  validationError: "バリデーション中にエラーが発生しました",
};

/**
 * バリデーションメッセージ管理用カスタムフック
 *
 * 機能:
 * - 国際化対応のメッセージ管理
 * - カスタムメッセージの設定
 * - デフォルトメッセージの提供
 */
export const useValidationMessages = (
  customMessages?: Partial<ValidationMessages>,
) => {
  const messages = { ...DEFAULT_MESSAGES, ...customMessages };

  const getRequiredMessage = useCallback(() => {
    return messages.required;
  }, [messages.required]);

  const getMinLengthMessage = useCallback(
    (min: number) => {
      return messages.minLength(min);
    },
    [messages.minLength],
  );

  const getMaxLengthMessage = useCallback(
    (max: number) => {
      return messages.maxLength(max);
    },
    [messages.maxLength],
  );

  const getValidationErrorMessage = useCallback(() => {
    return messages.validationError;
  }, [messages.validationError]);

  return {
    getRequiredMessage,
    getMinLengthMessage,
    getMaxLengthMessage,
    getValidationErrorMessage,
    messages,
  };
};
