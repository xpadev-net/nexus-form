import { useCallback, useEffect, useRef, useState } from "react";
import { logError } from "@/lib/logger";
import type { Block } from "@/types/domain/form-block";
import { validateLongText } from "@/utils/validation/question-validators";

interface UseLongTextValidationProps {
  question: Block;
  externalError?: string;
  warningThreshold?: number; // 警告閾値（デフォルト80%）
}

interface UseLongTextValidationReturn {
  validationError: string | undefined;
  isValidating: boolean;
  triggerValidation: (newValue: string) => void;
  isNearLimit: boolean;
  warningThreshold: number;
}

/**
 * 長文テキストのバリデーション用カスタムフック
 *
 * 機能:
 * - デバウンス付きバリデーション
 * - エラーハンドリング
 * - バリデーション状態の管理
 */
export const useLongTextValidation = ({
  question,
  externalError,
  warningThreshold = 0.8, // デフォルト80%
}: UseLongTextValidationProps): UseLongTextValidationReturn => {
  const [validationError, setValidationError] = useState<string | undefined>(
    externalError,
  );
  const [isValidating, setIsValidating] = useState(false);
  const [isNearLimit, setIsNearLimit] = useState(false);
  const validationTimeoutRef = useRef<number | null>(null);

  // デバウンス付きバリデーション
  const debouncedValidation = useCallback(
    (newValue: string) => {
      if (validationTimeoutRef.current) {
        window.clearTimeout(validationTimeoutRef.current);
      }

      // 警告閾値のチェック（即座に実行）
      const validation = question.validation;
      if (validation && "maxLength" in validation && validation.maxLength) {
        const percentage = newValue.length / validation.maxLength;
        setIsNearLimit(percentage >= warningThreshold);
      }

      validationTimeoutRef.current = window.setTimeout(() => {
        try {
          setIsValidating(true);
          if (question.validation) {
            const validationResult = validateLongText(question, {
              question_type: "long_text",
              value: newValue,
            });

            if (
              !validationResult.is_valid &&
              validationResult.errors.length > 0
            ) {
              const firstError = validationResult.errors[0];
              setValidationError(
                firstError ? firstError.message : "バリデーションエラー",
              );
            } else {
              setValidationError(undefined);
            }
          }
        } catch (error) {
          logError("Validation error:", "ui", { error: error });
          setValidationError("バリデーション中にエラーが発生しました");
        } finally {
          setIsValidating(false);
        }
      }, 300); // 300ms デバウンス
    },
    [question, warningThreshold],
  );

  // バリデーションのトリガー
  const triggerValidation = useCallback(
    (newValue: string) => {
      debouncedValidation(newValue);
    },
    [debouncedValidation],
  );

  // 外部エラーの同期
  useEffect(() => {
    setValidationError(externalError);
  }, [externalError]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        window.clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

  return {
    validationError,
    isValidating,
    triggerValidation,
    isNearLimit,
    warningThreshold,
  };
};
