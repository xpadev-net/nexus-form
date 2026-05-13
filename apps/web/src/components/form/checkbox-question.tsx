import { type ChangeEvent, type FC, memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCheckboxValidation } from "@/hooks/forms/useCheckboxValidation";
import { useOtherOption } from "@/hooks/forms/useOtherOption";
import { cn } from "@/lib/utils";
import type { Block, CheckboxFormBlock } from "@/types/domain/form-block";

/**
 * CheckboxQuestionコンポーネントのProps
 */
interface CheckboxQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof CheckboxFormBlock> | Block;
  /** 現在の選択値（配列） */
  value?: string[];
  /** 選択値変更時のコールバック */
  onChange: (value: string[]) => void;
  /** フォーカスアウト時のコールバック */
  onBlur?: () => void;
  /** エラーメッセージ */
  error?: string;
  /** 無効化フラグ */
  disabled?: boolean;
  /** カスタムCSSクラス */
  className?: string;
  /** その他の選択肢の入力値 */
  otherValue?: string;
  /** その他の選択肢の入力値変更時のコールバック */
  onOtherChange?: (value: string) => void;
}

/**
 * チェックボックス選択用の質問コンポーネント
 *
 * 機能:
 * - 複数選択機能
 * - 選択数制限（最小・最大）
 * - その他の選択肢対応
 * - バリデーション機能
 * - エラーメッセージ表示
 * - アクセシビリティ対応（ARIA属性）
 * - キーボードナビゲーション対応
 *
 * @example
 * ```tsx
 * <CheckboxQuestion
 *   question={checkboxQuestion}
 *   value={selectedValues}
 *   onChange={setSelectedValues}
 *   error={validationError}
 * />
 * ```
 *
 * @param props - コンポーネントのプロパティ
 * @returns JSX要素
 */
const _CheckboxQuestionComponent: FC<CheckboxQuestionProps> = ({
  block,
  value = [],
  onChange,
  onBlur,
  error,
  disabled = false,
  className,
  otherValue = "",
  onOtherChange,
}) => {
  // Block型がcheckboxタイプであることを確認
  if (block.type !== "checkbox") {
    throw new Error("CheckboxQuestionComponent requires a checkbox block");
  }

  // その他の選択肢に関する状態を取得
  const { hasOtherOption, isOtherSelected } = useOtherOption(block, value);

  // バリデーション設定をメモ化
  const validation = useMemo(() => block.validation, [block.validation]);

  // 選択数制限のバリデーション
  const { isValid: isValidSelection, errorMessage: validationError } =
    useCheckboxValidation(value, validation);

  // 選択肢の変更ハンドラー
  const handleOptionChange = useCallback(
    (optionValue: string, checked: boolean) => {
      const newValue = checked
        ? [...value, optionValue]
        : value.filter((v) => v !== optionValue);
      onChange(newValue);
    },
    [value, onChange],
  );

  // その他の選択肢の変更ハンドラー
  const handleOtherChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        onChange([...value, "other"]);
      } else {
        onChange(value.filter((v) => v !== "other"));
      }
    },
    [value, onChange],
  );

  // その他の選択肢の入力値変更ハンドラー
  const handleOtherInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      onOtherChange?.(newValue);
    },
    [onOtherChange],
  );

  // フォーカスアウトハンドラー
  const handleBlur = useCallback(() => {
    onBlur?.();
  }, [onBlur]);

  // 選択肢のレンダリング
  const renderOptions = useMemo(() => {
    return block.validation.options.map((option) => (
      <div key={option.id} className="flex items-center space-x-2">
        <Checkbox
          id={`${block.blockId}-${option.id}`}
          checked={value.includes(option.id)}
          onCheckedChange={(checked) =>
            handleOptionChange(option.id, checked as boolean)
          }
          disabled={disabled}
          className="peer"
        />
        <Label
          htmlFor={`${block.blockId}-${option.id}`}
          className="text-sm font-normal cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
        >
          {option.label}
        </Label>
      </div>
    ));
  }, [
    block.blockId,
    block.validation.options,
    value,
    handleOptionChange,
    disabled,
  ]);

  // その他の選択肢のレンダリング
  const renderOtherOption = useMemo(() => {
    if (!hasOtherOption) return null;

    return (
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${block.blockId}-other`}
            checked={isOtherSelected}
            onCheckedChange={handleOtherChange}
            disabled={disabled}
            className="peer"
          />
          <Label
            htmlFor={`${block.blockId}-other`}
            className="text-sm font-normal cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          >
            {block.validation.otherLabel || "その他"}
          </Label>
        </div>
        {isOtherSelected && (
          <div className="ml-6">
            <Input
              value={otherValue}
              onChange={handleOtherInputChange}
              onBlur={handleBlur}
              placeholder="具体的な内容を入力してください"
              disabled={disabled}
              className="w-full"
              aria-describedby={error ? `${block.blockId}-error` : undefined}
            />
          </div>
        )}
      </div>
    );
  }, [
    hasOtherOption,
    block.blockId,
    block.validation.otherLabel,
    disabled,
    isOtherSelected,
    otherValue,
    handleOtherChange,
    handleOtherInputChange,
    handleBlur,
    error,
  ]);

  // 選択数制限の表示（依存関係を最適化）
  const renderSelectionLimit = useMemo(() => {
    const { minSelections, maxSelections } = validation;
    if (!minSelections && !maxSelections) return null;

    const currentCount = value.length;
    const parts = [];

    if (minSelections) {
      parts.push(`最小: ${minSelections}個`);
    }
    if (maxSelections) {
      parts.push(`最大: ${maxSelections}個`);
    }

    return (
      <div className="text-xs text-muted-foreground">
        {parts.join("、")} (現在: {currentCount}個)
      </div>
    );
  }, [
    validation.minSelections,
    validation.maxSelections,
    value.length,
    validation,
  ]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* 質問ラベル */}
      {block.validation.required && (
        <Badge variant="destructive" className="w-fit">
          必須
        </Badge>
      )}
      <Label htmlFor={block.blockId} className="text-sm font-medium">
        {block.title}
        {block.validation.required && <span className="sr-only">（必須）</span>}
      </Label>

      {/* 説明文 */}
      {block.description && (
        <p className="text-sm text-muted-foreground">{block.description}</p>
      )}

      {/* チェックボックスグループ */}
      <fieldset
        className="space-y-2"
        aria-describedby={[
          block.description ? `${block.blockId}-description` : null,
          error ? `${block.blockId}-error` : null,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={!!error || !isValidSelection}
        aria-label={block.title}
      >
        {renderOptions}
        {renderOtherOption}
      </fieldset>

      {/* 選択数制限の表示 */}
      {renderSelectionLimit}

      {/* バリデーションエラーメッセージ */}
      {!isValidSelection && validationError && (
        <div
          id={`${block.blockId}-validation-error`}
          className="text-sm text-destructive"
          role="alert"
          aria-live="polite"
        >
          {validationError}
        </div>
      )}

      {/* エラーメッセージ */}
      {error && (
        <p
          id={`${block.blockId}-error`}
          className="text-sm text-destructive"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      )}

      {/* 説明文のID設定（アクセシビリティ） */}
      {block.description && (
        <div id={`${block.blockId}-description`} className="sr-only">
          {block.description}
        </div>
      )}
    </div>
  );
};

// memoでパフォーマンス最適化
export const CheckboxQuestionComponent = memo(_CheckboxQuestionComponent);
