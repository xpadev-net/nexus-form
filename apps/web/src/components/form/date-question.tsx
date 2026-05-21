import { memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import type { Block, DateFormBlock } from "@/types/domain/form-block";
import { useGenericValidation } from "./hooks/useGenericValidation";
import { BaseQuestionInput } from "./shared/BaseQuestionInput";
import { DateTimeUtils, InputMasking } from "./utils/consolidated-utils";
import { createDateValidator } from "./utils/validation-helpers";

/**
 * DateQuestionコンポーネントのProps
 */
interface DateQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof DateFormBlock> | Block;
  /** 現在の値 */
  value?: string;
  /** 値が変更された時のコールバック */
  onChange: (value: string) => void;
  /** 外部から設定されるエラーメッセージ */
  error?: string;
  /** 無効化状態 */
  disabled?: boolean;
  /** 追加のCSSクラス */
  className?: string;
  /** デバウンス遅延時間（ミリ秒、デフォルト: 300） */
  debounceDelay?: number;
}

/**
 * 日付入力用の質問コンポーネント（最適化版）
 *
 * 最適化の改善点：
 * - 統合されたユーティリティ関数の使用
 * - バンドルサイズの削減
 * - 入力マスキングの改善
 * - バリデーション機能の強化
 */
function DateQuestionBase({
  block,
  value = "",
  onChange,
  error,
  disabled = false,
  className,
  debounceDelay = 300,
}: DateQuestionProps) {
  // Block型がdateタイプであることを確認
  if (block.type !== "date") {
    throw new Error("DateQuestionComponent requires a date block");
  }

  const dateFormat = block.validation?.format || "YYYY-MM-DD";

  // バリデーション処理
  const validator = useMemo(() => createDateValidator(block), [block]);
  const { validationError, isValidating } = useGenericValidation(value, {
    validator,
    debounceDelay,
  });

  // 表示するエラーメッセージ
  const displayError = error || validationError;

  // 入力値の正規化とマスキング
  const updateDateValue = useCallback(
    (inputValue: string) => {
      let normalizedValue = DateTimeUtils.normalizeDateValue(
        inputValue,
        dateFormat,
      );

      // カスタムフォーマットの場合はマスキングを適用
      if (dateFormat !== "YYYY-MM-DD") {
        if (dateFormat === "MM/DD/YYYY") {
          normalizedValue = InputMasking.maskMMDDYYYY(inputValue);
        } else if (dateFormat === "DD/MM/YYYY") {
          normalizedValue = InputMasking.maskDDMMYYYY(inputValue);
        }
      }

      onChange(normalizedValue);
    },
    [dateFormat, onChange],
  );

  // 日付範囲情報の生成
  const rangeInfo = useMemo(() => {
    const { minDate, maxDate } = block.validation || {};

    if (minDate && maxDate) {
      return `日付範囲: ${minDate} ～ ${maxDate}`;
    } else if (minDate) {
      return `最小日付: ${minDate}`;
    } else if (maxDate) {
      return `最大日付: ${maxDate}`;
    }
    return undefined;
  }, [block.validation]);

  // フォーマット情報の生成
  const formatInfo = useMemo(() => {
    if (dateFormat === "YYYY-MM-DD") {
      return undefined;
    }
    return `日付形式: ${dateFormat}`;
  }, [dateFormat]);

  return (
    <BaseQuestionInput
      id={block.blockId}
      title={block.title}
      description={block.description}
      value={value}
      onChange={updateDateValue}
      type={DateTimeUtils.getDateInputType(dateFormat)}
      placeholder={DateTimeUtils.getDatePlaceholder(dateFormat)}
      disabled={disabled}
      className={className}
      error={displayError}
      isValidating={isValidating}
      formatInfo={formatInfo}
      rangeInfo={rangeInfo}
      inputFormat={dateFormat !== "YYYY-MM-DD" ? dateFormat : undefined}
    />
  );
}

DateQuestionBase.displayName = "DateQuestion";

// メモ化の比較関数
const areDateQuestionPropsEqual = (
  prevProps: DateQuestionProps,
  nextProps: DateQuestionProps,
): boolean => {
  return (
    prevProps.block.blockId === nextProps.block.blockId &&
    prevProps.block.title === nextProps.block.title &&
    prevProps.block.description === nextProps.block.description &&
    prevProps.block.validation === nextProps.block.validation &&
    prevProps.value === nextProps.value &&
    prevProps.error === nextProps.error &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.className === nextProps.className &&
    prevProps.debounceDelay === nextProps.debounceDelay
  );
};

export const DateQuestionComponent = memo(
  DateQuestionBase,
  areDateQuestionPropsEqual,
);
