import { type FC, memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { Block, LinearScaleFormBlock } from "@/types/domain/form-block";

/**
 * LinearScaleQuestionコンポーネントのProps
 */
interface LinearScaleQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof LinearScaleFormBlock> | Block;
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
 * 均等目盛質問用のコンポーネント
 *
 * 機能:
 * - スライダーによる値の選択
 * - カスタムラベル（最小・最大値）
 * - ステップ値の設定
 * - バリデーション機能
 * - アクセシビリティ対応
 * - レスポンシブデザイン
 * - パフォーマンス最適化（memo）
 *
 * @example
 * ```tsx
 * <LinearScaleQuestion
 *   question={question}
 *   value={value}
 *   onChange={setValue}
 *   error={error}
 * />
 * ```
 *
 * @performance
 * - memoによる不要な再レンダリング防止
 * - スライダーの値変更時の最適化
 *
 * @accessibility
 * - ARIA属性によるスクリーンリーダー対応
 * - キーボードナビゲーション対応
 * - 値の音声読み上げ対応
 */
const _LinearScaleQuestionComponent: FC<LinearScaleQuestionProps> = ({
  block,
  value,
  onChange,
  error,
  disabled = false,
  className,
}) => {
  // Block型がlinear_scaleタイプであることを確認
  if (block.type !== "linear_scale") {
    throw new Error(
      "LinearScaleQuestionComponent requires a linear_scale block",
    );
  }

  const { validation } = block;

  // スライダーの設定値を計算
  const sliderConfig = useMemo(() => {
    const min = validation.min;
    const max = validation.max;
    const step = validation.step || 1;
    const range = max - min;
    const steps = Math.floor(range / step) + 1;

    return {
      min,
      max,
      step,
      range,
      steps,
    };
  }, [validation]);

  // 現在の値の正規化（未選択の場合は最小値）
  const currentValue = value ?? validation.min;

  // 値の変更ハンドラー
  const handleValueChange = useCallback(
    (newValue: number[]) => {
      const first = newValue[0];
      if (first !== undefined) {
        onChange(first);
      }
    },
    [onChange],
  );

  // 値の表示用フォーマット
  const formatValue = useCallback((val: number) => {
    return val.toString();
  }, []);

  // スケールの目盛りを生成
  const scaleMarks = useMemo(() => {
    const marks = [];
    const { min, max } = sliderConfig;

    // 最大10個の目盛りを表示
    const maxMarks = 10;
    const interval = Math.max(1, Math.floor((max - min) / maxMarks));

    for (let i = min; i <= max; i += interval) {
      marks.push(i);
    }

    // 最大値が含まれていない場合は追加
    if (marks[marks.length - 1] !== max) {
      marks.push(max);
    }

    return marks;
  }, [sliderConfig]);

  // カスタムスケールの目盛りラベルを生成
  const customScaleLabels = useMemo(() => {
    const labels: Record<number, string> = {};

    // カスタムラベルが設定されている場合の処理
    if (validation.minLabel && validation.maxLabel) {
      // 中間値にもラベルを設定
      const midValue = Math.floor((validation.min + validation.max) / 2);
      labels[validation.min] = validation.minLabel;
      labels[midValue] = "中間";
      labels[validation.max] = validation.maxLabel;
    }

    return labels;
  }, [validation]);

  // 目盛りの表示ラベルを取得
  const getMarkLabel = useCallback(
    (mark: number) => {
      return customScaleLabels[mark] || mark.toString();
    },
    [customScaleLabels],
  );

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

      {/* スケール表示エリア */}
      <div className="space-y-3">
        {/* ラベル表示 */}
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>{validation.minLabel || validation.min}</span>
          <span className="font-medium text-foreground">
            {formatValue(currentValue)}
          </span>
          <span>{validation.maxLabel || validation.max}</span>
        </div>

        {/* スライダー */}
        <div className="px-2">
          <Slider
            id={block.blockId}
            value={[currentValue]}
            onValueChange={handleValueChange}
            min={sliderConfig.min}
            max={sliderConfig.max}
            step={sliderConfig.step}
            disabled={disabled}
            className={cn(
              "w-full",
              error && "border-destructive focus-visible:ring-destructive",
            )}
            aria-describedby={error ? `${block.blockId}-error` : undefined}
            aria-invalid={!!error}
            aria-disabled={disabled}
          />
        </div>

        {/* 目盛り表示 */}
        <div className="flex justify-between text-xs text-muted-foreground">
          {scaleMarks.map((mark) => (
            <span
              key={mark}
              className={cn(
                "flex-1 text-center",
                mark === currentValue && "font-semibold text-foreground",
              )}
            >
              {getMarkLabel(mark)}
            </span>
          ))}
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

      {/* スケール情報 */}
      <div className="text-xs text-muted-foreground">
        <p>
          範囲: {validation.min} 〜 {validation.max}
          {validation.step &&
            validation.step > 1 &&
            ` (ステップ: ${validation.step})`}
        </p>
      </div>
    </div>
  );
};

// プロップス比較の簡素化
const arePropsEqual = (
  prevProps: LinearScaleQuestionProps,
  nextProps: LinearScaleQuestionProps,
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

  // Blockオブジェクトの詳細比較
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

  // スケール設定の比較
  const prevScale = prevProps.block.validation as {
    min: number;
    max: number;
    minLabel?: string;
    maxLabel?: string;
    step: number;
  };
  const nextScale = nextProps.block.validation as {
    min: number;
    max: number;
    minLabel?: string;
    maxLabel?: string;
    step: number;
  };

  return (
    prevScale.min === nextScale.min &&
    prevScale.max === nextScale.max &&
    prevScale.minLabel === nextScale.minLabel &&
    prevScale.maxLabel === nextScale.maxLabel &&
    prevScale.step === nextScale.step
  );
};

// memoでパフォーマンス最適化
export const LinearScaleQuestionComponent = memo(
  _LinearScaleQuestionComponent,
  arePropsEqual,
);
