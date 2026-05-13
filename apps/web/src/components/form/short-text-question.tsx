import {
  type ChangeEvent,
  type FC,
  type FocusEvent,
  useCallback,
  useMemo,
} from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShortTextValidation } from "@/hooks/forms/useShortTextValidation";
import { getShortTextPlaceholder } from "@/lib/forms/short-text-placeholder";
import { cn } from "@/lib/utils";
import {
  getValidationPatternTemplate,
  useValidationProviders,
} from "@/lib/validation/validation-providers";
import type { Block, ShortTextFormBlock } from "@/types/domain/form-block";

/**
 * ShortTextQuestionコンポーネントのProps
 */
interface ShortTextQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof ShortTextFormBlock> | Block;
  /** 現在の入力値 */
  value?: string;
  /** 入力値変更時のコールバック */
  onChange: (value: string) => void;
  /** フォーカスアウト時のコールバック */
  onBlur?: () => void;
  /** エラーメッセージ */
  error?: string;
  /** 無効化フラグ */
  disabled?: boolean;
  /** カスタムCSSクラス */
  className?: string;
  /** 文字数カウンター表示フラグ */
  showCharacterCount?: boolean;
  /** カスタムプレースホルダー */
  placeholder?: string;
  /** デバウンス遅延時間（ミリ秒） */
  debounceDelay?: number;
}

/**
 * 短文テキスト入力用の質問コンポーネント
 *
 * 機能:
 * - リアルタイムバリデーション（デバウンス付き）
 * - 文字数カウンター表示
 * - エラーメッセージ表示
 * - アクセシビリティ対応（ARIA属性）
 * - カスタムプレースホルダー生成
 *
 * @param props - コンポーネントのプロパティ
 * @returns JSX要素
 */
export const ShortTextQuestionComponent: FC<ShortTextQuestionProps> = ({
  block,
  value = "",
  onChange,
  onBlur,
  error,
  disabled = false,
  className,
  showCharacterCount = true,
  placeholder,
  debounceDelay = 300,
}) => {
  // Block型がshort_textタイプであることを確認
  if (block.type !== "short_text") {
    throw new Error("ShortTextQuestionComponent requires a short_text block");
  }

  const { data: validationProvidersData } = useValidationProviders();
  const validationProviders = validationProvidersData?.data ?? [];
  const templateInputType = block.validation?.patternTemplate
    ? getValidationPatternTemplate(
        block.validation.patternTemplate,
        validationProviders,
      )?.inputType
    : undefined;
  const inputType = templateInputType ?? "text";

  // カスタムフックを使用してバリデーションロジックを分離
  const { localError, isValidating, validateValue } = useShortTextValidation(
    block,
    value,
    debounceDelay,
  );

  // エラーメッセージの優先順位: props > ローカルエラー
  const displayError = error || localError;

  // 入力値変更ハンドラー
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      onChange(newValue);
    },
    [onChange],
  );

  // フォーカスアウトハンドラー
  const handleBlur = useCallback(
    async (event: FocusEvent<HTMLInputElement>) => {
      const inputValue = event.target.value;

      // フォーカスアウト時にバリデーション実行
      if (block.validation) {
        await validateValue(inputValue);
      }

      onBlur?.();
    },
    [validateValue, onBlur, block.validation],
  );

  // 文字数カウンター表示
  const characterCount = useMemo(() => {
    if (!showCharacterCount || !block.validation?.maxLength) return null;

    const currentLength = value.length;
    const maxLength = block.validation.maxLength;

    return (
      <div className="text-xs text-muted-foreground mt-1">
        {currentLength}/{maxLength}
        {block.validation.minLength && (
          <span className="ml-2">(最小: {block.validation.minLength})</span>
        )}
      </div>
    );
  }, [value.length, block.validation, showCharacterCount]);

  // プレースホルダーテキスト
  const displayPlaceholder = useMemo(
    () =>
      getShortTextPlaceholder({
        placeholder,
        validation: block.validation,
      }),
    [placeholder, block.validation],
  );

  return (
    <div className={cn("space-y-2", className)}>
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

      {/* 入力フィールド */}
      <div className="relative">
        <Input
          id={block.blockId}
          type={inputType}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={displayPlaceholder}
          disabled={disabled}
          aria-describedby={[
            block.description ? `${block.blockId}-description` : null,
            displayError ? `${block.blockId}-error` : null,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={!!displayError}
          className={cn(
            "transition-colors",
            displayError && "border-destructive focus-visible:ring-destructive",
            isValidating && "opacity-70",
          )}
        />

        {/* ローディングインジケーター */}
        {isValidating && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        )}
      </div>

      {/* 文字数カウンター */}
      {characterCount}

      {/* エラーメッセージ */}
      {displayError && (
        <p
          id={`${block.blockId}-error`}
          className="text-sm text-destructive"
          role="alert"
          aria-live="polite"
        >
          {displayError}
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

export default ShortTextQuestionComponent;
