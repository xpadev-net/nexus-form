import { memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import type { Block, TimeFormBlock } from "@/types/domain/form-block";
import { useGenericValidation } from "./hooks/useGenericValidation";
import { BaseQuestionInput } from "./shared/BaseQuestionInput";
import { DateTimeUtils, InputMasking } from "./utils/consolidated-utils";
import { createTimeValidator } from "./utils/validation-helpers";

/**
 * TimeQuestionコンポーネントのProps
 */
interface TimeQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof TimeFormBlock> | Block;
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
 * 時刻入力用の質問コンポーネント（最適化版）
 *
 * 最適化の改善点：
 * - 統合されたユーティリティ関数の使用
 * - バンドルサイズの削減
 * - 入力マスキングの改善
 * - バリデーション機能の強化
 */
const _TimeQuestionComponent = memo<TimeQuestionProps>(
  ({
    block,
    value = "",
    onChange,
    error,
    disabled = false,
    className,
    debounceDelay = 300,
  }) => {
    // Block型がtimeタイプであることを確認
    if (block.type !== "time") {
      throw new Error("TimeQuestionComponent requires a time block");
    }

    const timeFormat = block.validation?.format || "24h";

    // バリデーション処理
    const validator = useMemo(() => createTimeValidator(block), [block]);
    const { validationError, isValidating } = useGenericValidation(value, {
      validator,
      debounceDelay,
    });

    // 表示するエラーメッセージ
    const displayError = error || validationError;

    // 入力値の正規化とマスキング
    const handleChange = useCallback(
      (inputValue: string) => {
        let processedValue = inputValue;

        // 12hフォーマットの場合はマスキングを適用
        if (timeFormat === "12h") {
          processedValue = InputMasking.mask12HourTime(inputValue);
        }

        // 正規化を適用
        const normalizedValue = DateTimeUtils.normalizeTimeValue(
          processedValue,
          timeFormat,
        );

        onChange(normalizedValue);
      },
      [timeFormat, onChange],
    );

    // 時刻範囲情報の生成
    const rangeInfo = useMemo(() => {
      const { minTime, maxTime } = block.validation || {};

      if (minTime && maxTime) {
        return `時刻範囲: ${minTime} ～ ${maxTime}`;
      } else if (minTime) {
        return `最小時刻: ${minTime}`;
      } else if (maxTime) {
        return `最大時刻: ${maxTime}`;
      }
      return undefined;
    }, [block.validation]);

    // フォーマット情報の生成
    const formatInfo = useMemo(() => {
      if (timeFormat === "24h") {
        return undefined;
      }
      return `時刻形式: ${timeFormat}`;
    }, [timeFormat]);

    return (
      <BaseQuestionInput
        id={block.blockId}
        title={block.title}
        description={block.description}
        value={value}
        onChange={onChange}
        onInputChange={handleChange}
        type={DateTimeUtils.getTimeInputType(timeFormat)}
        placeholder={DateTimeUtils.getTimePlaceholder(timeFormat)}
        disabled={disabled}
        className={className}
        error={displayError}
        isValidating={isValidating}
        formatInfo={formatInfo}
        rangeInfo={rangeInfo}
        inputFormat={timeFormat === "12h" ? "12h" : undefined}
      />
    );
  },
);

// メモ化の比較関数
const areTimeQuestionPropsEqual = (
  prevProps: TimeQuestionProps,
  nextProps: TimeQuestionProps,
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

export const TimeQuestionComponent = memo(
  _TimeQuestionComponent,
  areTimeQuestionPropsEqual,
);
