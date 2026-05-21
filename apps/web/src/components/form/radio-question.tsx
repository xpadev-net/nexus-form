import { type ChangeEvent, type FC, memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useOtherOption } from "@/hooks/forms/use-other-option";
import { cn } from "@/lib/utils";
import type { Block, RadioFormBlock } from "@/types/domain/form-block";

/**
 * RadioQuestionコンポーネントのProps
 */
interface RadioQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof RadioFormBlock> | Block;
  /** 現在の選択値 */
  value?: string;
  /** 選択値変更時のコールバック */
  onChange: (value: string) => void;
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
 * ラジオボタン選択用の質問コンポーネント
 *
 * 機能:
 * - 単一選択機能
 * - その他の選択肢対応
 * - バリデーション機能
 * - エラーメッセージ表示
 * - アクセシビリティ対応（ARIA属性）
 * - キーボードナビゲーション対応
 *
 * @example
 * ```tsx
 * <RadioQuestion
 *   question={radioQuestion}
 *   value={selectedValue}
 *   onChange={setSelectedValue}
 *   error={validationError}
 * />
 * ```
 *
 * @param props - コンポーネントのプロパティ
 * @returns JSX要素
 */
const RadioQuestionBase: FC<RadioQuestionProps> = ({
  block,
  value = "",
  onChange,
  onBlur,
  error,
  disabled = false,
  className,
  otherValue = "",
  onOtherChange,
}) => {
  // Block型がradioタイプであることを確認
  if (block.type !== "radio") {
    throw new Error("RadioQuestionComponent requires a radio block");
  }

  // その他の選択肢に関する状態を取得
  const { hasOtherOption, isOtherSelected } = useOtherOption(block, value);

  // 選択肢の変更ハンドラー
  const handleValueChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
    },
    [onChange],
  );

  // その他の選択肢の入力値変更ハンドラー
  const handleOtherChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      onOtherChange?.(newValue);
    },
    [onOtherChange],
  );

  // フォーカスアウトハンドラー
  const validateOtherValueOnBlur = useCallback(() => {
    onBlur?.();
  }, [onBlur]);

  // 選択肢のレンダリング
  const renderOptions = useMemo(() => {
    return block.validation.options.map((option) => (
      <div key={option.id} className="flex items-center space-x-2">
        <RadioGroupItem
          value={option.id}
          id={`${block.blockId}-${option.id}`}
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
  }, [block.blockId, block.validation.options, disabled]);

  // その他の選択肢のレンダリング
  const renderOtherOption = useMemo(() => {
    if (!hasOtherOption) return null;

    return (
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <RadioGroupItem
            value="other"
            id={`${block.blockId}-other`}
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
              onChange={handleOtherChange}
              onBlur={validateOtherValueOnBlur}
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
    validateOtherValueOnBlur,
    error,
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

      {/* ラジオボタングループ */}
      <RadioGroup
        value={value}
        onValueChange={handleValueChange}
        disabled={disabled}
        className="space-y-2"
        aria-describedby={[
          block.description ? `${block.blockId}-description` : null,
          error ? `${block.blockId}-error` : null,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={!!error}
        aria-label={block.title}
        role="radiogroup"
      >
        {renderOptions}
        {renderOtherOption}
      </RadioGroup>

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
export const RadioQuestionComponent = memo(RadioQuestionBase);
