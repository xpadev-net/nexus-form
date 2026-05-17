import { type FC, memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { RatingFormBlock } from "@/types/domain/form-block";
import { RatingIcon } from "./rating-icon";

/**
 * RatingQuestionコンポーネントのProps
 */
interface RatingQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof RatingFormBlock>;
  /** 現在の値 */
  value?: number;
  /** 値が変更された時のコールバック */
  onChange: (value: number) => void;
  /** 外部から設定されるエラーメッセージ */
  error?: string;
  /** 無効化状態 */
  disabled?: boolean;
  /** 追加のCSSクラス */
  className?: string;
}

/**
 * 評価質問用のコンポーネント
 *
 * 機能:
 * - 星、ハート、サムズアップのアイコン評価
 * - ホバー効果とアニメーション
 * - バリデーション機能
 * - アクセシビリティ対応
 * - レスポンシブデザイン
 * - パフォーマンス最適化（memo）
 *
 * @example
 * ```tsx
 * <RatingQuestion
 *   question={question}
 *   value={value}
 *   onChange={setValue}
 *   error={error}
 * />
 * ```
 *
 * @performance
 * - memoによる不要な再レンダリング防止
 * - アイコンの最適化されたレンダリング
 *
 * @accessibility
 * - ARIA属性によるスクリーンリーダー対応
 * - キーボードナビゲーション対応
 * - 値の音声読み上げ対応
 */
const RatingQuestionBase: FC<RatingQuestionProps> = ({
  block,
  value,
  onChange,
  error,
  disabled = false,
  className,
}) => {
  if (block.type !== "rating") {
    throw new Error("Invalid block type for RatingQuestionComponent");
  }

  const { validation } = block;
  const maxRating = validation.maxRating;
  const iconType = validation.icon || "star";

  // 現在の値の正規化（未選択の場合は0）
  const currentValue = value ?? 0;

  // アイコンのレンダリング
  const renderIcon = useCallback(
    (_index: number, isActive: boolean, isHovered: boolean) => {
      return (
        <RatingIcon
          type={iconType}
          isActive={isActive}
          isHovered={isHovered}
          disabled={disabled}
          size={8}
        />
      );
    },
    [iconType, disabled],
  );

  // 評価値の変更ハンドラー
  const handleRatingChange = useCallback(
    (newValue: number) => {
      if (!disabled) {
        onChange(newValue);
      }
    },
    [onChange, disabled],
  );

  // 評価値の配列を生成
  const ratingValues = useMemo(() => {
    return Array.from({ length: maxRating }, (_, index) => index + 1);
  }, [maxRating]);

  // 評価値の表示用フォーマット
  const formatRating = useCallback(
    (rating: number) => {
      if (rating === 0) return "未評価";
      return `${rating}/${maxRating}`;
    },
    [maxRating],
  );

  // カスタム評価ラベルの生成
  const customRatingLabels = useMemo(() => {
    const labels: Record<number, string> = {};

    // 評価値に応じたカスタムラベル
    for (let i = 1; i <= maxRating; i++) {
      switch (iconType) {
        case "star":
          labels[i] = `${i}つ星`;
          break;
        case "heart":
          labels[i] = `${i}つハート`;
          break;
        case "thumbs":
          labels[i] = `${i}つサムズアップ`;
          break;
        default:
          labels[i] = `${i}評価`;
      }
    }

    return labels;
  }, [maxRating, iconType]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* 質問ラベル */}
      {validation.required && (
        <Badge variant="destructive" className="w-fit">
          必須
        </Badge>
      )}
      <Label htmlFor={block.blockId} className="text-base font-medium">
        {block.title}
        {validation.required && <span className="sr-only">（必須）</span>}
      </Label>

      {/* 説明文 */}
      {block.description && (
        <p className="text-sm text-muted-foreground">{block.description}</p>
      )}

      {/* 評価表示エリア */}
      <div className="space-y-3">
        {/* 現在の評価値表示 */}
        <div className="flex justify-center">
          <span className="text-lg font-medium text-foreground">
            {formatRating(currentValue)}
          </span>
        </div>

        {/* 評価アイコン */}
        <div
          id={block.blockId}
          className="flex justify-center gap-2"
          role="radiogroup"
          aria-labelledby={block.blockId}
          aria-describedby={error ? `${block.blockId}-error` : undefined}
        >
          {ratingValues.map((ratingValue) => {
            const isActive = ratingValue <= currentValue;
            const isSelected = ratingValue === currentValue;
            const isHovered = false; // ホバー状態はCSSで管理

            return (
              <label
                key={ratingValue}
                className={cn(
                  "inline-block p-1 rounded-lg transition-all duration-200 cursor-pointer",
                  "hover:bg-muted focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name={`${block.blockId}-rating`}
                  value={ratingValue}
                  checked={isSelected}
                  onChange={() => handleRatingChange(ratingValue)}
                  disabled={disabled}
                  className="sr-only"
                  aria-invalid={!!error}
                  aria-label={
                    customRatingLabels[ratingValue] ||
                    `評価 ${ratingValue} を選択`
                  }
                />
                {renderIcon(ratingValue, isActive, isHovered)}
              </label>
            );
          })}
        </div>

        {/* 評価の説明 */}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>最低</span>
          <span>最高</span>
        </div>
      </div>

      {/* エラーメッセージ */}
      {error && (
        <p
          id={`${block.blockId}-error`}
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* 評価情報 */}
      <div className="text-xs text-muted-foreground">
        <p>
          評価範囲: 1 〜 {maxRating}
          {iconType && ` (${iconType}アイコン)`}
        </p>
      </div>
    </div>
  );
};

// プロップス比較の簡素化
const arePropsEqual = (
  prevProps: RatingQuestionProps,
  nextProps: RatingQuestionProps,
) => {
  // 基本的なプロップの比較
  if (
    prevProps.block.blockId !== nextProps.block.blockId ||
    prevProps.value !== nextProps.value ||
    prevProps.error !== nextProps.error ||
    prevProps.disabled !== nextProps.disabled ||
    prevProps.className !== nextProps.className
  ) {
    return false;
  }

  // ブロックオブジェクトの詳細比較
  if (
    prevProps.block.type !== nextProps.block.type ||
    prevProps.block.title !== nextProps.block.title ||
    prevProps.block.description !== nextProps.block.description ||
    prevProps.block.validation.required !==
      nextProps.block.validation.required ||
    prevProps.block.order !== nextProps.block.order
  ) {
    return false;
  }

  // 評価設定の比較
  const prevRating = prevProps.block.validation as {
    maxRating: number;
    icon?: string;
  };
  const nextRating = nextProps.block.validation as {
    maxRating: number;
    icon?: string;
  };

  return (
    prevRating.maxRating === nextRating.maxRating &&
    prevRating.icon === nextRating.icon
  );
};

// memoでパフォーマンス最適化
export const RatingQuestionComponent = memo(RatingQuestionBase, arePropsEqual);
