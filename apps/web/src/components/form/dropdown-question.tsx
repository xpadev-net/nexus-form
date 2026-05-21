import { type ChangeEvent, type FC, memo, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOtherOption } from "@/hooks/forms/use-other-option";
import { cn } from "@/lib/utils";
import type { Block, DropdownFormBlock } from "@/types/domain/form-block";

/**
 * DropdownQuestionコンポーネントのProps
 */
interface DropdownQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: DropdownFormBlock | Block;
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
  /** プレースホルダーテキスト */
  placeholder?: string;
}

/**
 * ドロップダウン選択用の質問コンポーネント
 *
 * 機能:
 * - 単一選択機能
 * - その他の選択肢対応
 * - バリデーション機能
 * - エラーメッセージ表示
 * - アクセシビリティ対応（ARIA属性）
 * - キーボードナビゲーション対応
 * - 検索機能（オプション）
 *
 * @example
 * ```tsx
 * <DropdownQuestion
 *   question={dropdownQuestion}
 *   value={selectedValue}
 *   onChange={setSelectedValue}
 *   error={validationError}
 * />
 * ```
 *
 * @param props - コンポーネントのプロパティ
 * @returns JSX要素
 */
const DropdownQuestionBase: FC<DropdownQuestionProps> = ({
  block,
  value = "",
  onChange,
  onBlur,
  error,
  disabled = false,
  className,
  otherValue = "",
  onOtherChange,
  placeholder,
}) => {
  // Block型がdropdownタイプであることを確認
  if (block.type !== "dropdown") {
    throw new Error("DropdownQuestionComponent requires a dropdown block");
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
      <SelectItem key={option.id} value={option.id}>
        {option.label}
      </SelectItem>
    ));
  }, [block.validation.options]);

  // その他の選択肢のレンダリング（SelectContent内のみ）
  const renderOtherOption = useMemo(() => {
    if (!hasOtherOption) return null;

    return (
      <SelectItem value="other">
        {block.validation.otherLabel || "その他"}
      </SelectItem>
    );
  }, [hasOtherOption, block.validation.otherLabel]);

  // プレースホルダーテキスト
  const displayPlaceholder = useMemo(() => {
    if (placeholder) return placeholder;
    return "選択してください";
  }, [placeholder]);

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

      {/* ドロップダウンセレクト */}
      <div className="space-y-2">
        <Select
          value={value}
          onValueChange={handleValueChange}
          disabled={disabled}
        >
          <SelectTrigger
            className={cn(
              "w-full",
              error && "border-destructive focus-visible:ring-destructive",
            )}
            aria-describedby={[
              block.description ? `${block.blockId}-description` : null,
              error ? `${block.blockId}-error` : null,
            ]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={!!error}
            aria-label={block.title}
          >
            <SelectValue placeholder={displayPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {renderOptions}
            {renderOtherOption}
          </SelectContent>
        </Select>

        {/* その他の選択肢の入力フィールド（外部表示） */}
        {isOtherSelected && (
          <div className="mt-2">
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
export const DropdownQuestionComponent = memo(DropdownQuestionBase);
