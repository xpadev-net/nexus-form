import { type FC, memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { deepEqual } from "@/lib/utils/deep-equal";
import type { ChoiceGridFormBlock } from "@/types/domain/form-block";
import { ErrorBoundary } from "./error-boundary";
import { useValidationMessages } from "./hooks/useValidationMessages";

/**
 * Props for the ChoiceGridQuestion component
 *
 * @interface ChoiceGridQuestionProps
 */
interface ChoiceGridQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof ChoiceGridFormBlock>;
  /** 現在の値（行ID -> 列IDのマッピング） */
  value?: Record<string, string>;
  /** 値が変更された時のコールバック */
  onChange: (value: Record<string, string>) => void;
  /** 外部から設定されるエラーメッセージ */
  error?: string;
  /** 無効化状態 */
  disabled?: boolean;
  /** 追加のCSSクラス */
  className?: string;
}

const EMPTY_CHOICE_GRID_VALUE: Record<string, string> = {};

interface ChoiceGridTableProps {
  block: z.infer<typeof ChoiceGridFormBlock>;
  value: Record<string, string>;
  disabled: boolean;
  onRowChange: (rowId: string, columnId: string) => void;
}

const ChoiceGridTable: FC<ChoiceGridTableProps> = ({
  block,
  value,
  disabled,
  onRowChange,
}) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="border border-border p-2 text-left font-medium bg-muted/50">
            {/* 空のヘッダー（行ラベル用） */}
          </th>
          {block.validation.columns.map((column, columnIndex) => (
            <th
              key={`${block.blockId}-column-${columnIndex}`}
              className="border border-border p-2 text-center font-medium bg-muted/50"
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.validation.rows.map((row, rowIndex) => (
          <tr key={`${block.blockId}-row-${rowIndex}`}>
            <td className="border border-border p-2 font-medium bg-muted/30">
              {row.label}
            </td>
            {block.validation.columns.map((column, columnIndex) => {
              const inputId = `${block.blockId}-${rowIndex}-${columnIndex}`;
              const isSelected = value[row.id] === column.id;
              const radioName = `${block.blockId}-row-${rowIndex}`;

              return (
                <td
                  key={column.id}
                  className="border border-border p-2 text-center"
                >
                  <input
                    type="radio"
                    id={inputId}
                    name={radioName}
                    value={column.id}
                    checked={isSelected}
                    onChange={() => onRowChange(row.id, column.id)}
                    disabled={disabled}
                    aria-label={`${row.label} - ${column.label}`}
                    className="h-4 w-4 border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * 選択式グリッド質問コンポーネント
 *
 * 機能:
 * - 行列形式の選択肢表示
 * - 各行で1つの選択肢のみ選択可能
 * - バリデーション機能
 * - アクセシビリティ対応
 * - レスポンシブデザイン
 * - パフォーマンス最適化（memo）
 *
 * @example
 * ```tsx
 * <ChoiceGridQuestion
 *   question={question}
 *   value={value}
 *   onChange={setValue}
 *   error={error}
 * />
 * ```
 */
const ChoiceGridQuestionInner: FC<ChoiceGridQuestionProps> = ({
  block,
  value = EMPTY_CHOICE_GRID_VALUE,
  onChange,
  error,
  disabled = false,
  className,
}) => {
  if (block.type !== "choice_grid") {
    throw new Error("Invalid block type for ChoiceGridQuestionComponent");
  }

  const { getRequiredMessage } = useValidationMessages();

  // 行の選択値変更ハンドラー
  const handleRowChange = useCallback(
    (rowId: string, columnId: string) => {
      const newValue = { ...value, [rowId]: columnId };
      onChange(newValue);
    },
    [value, onChange],
  );

  // バリデーションエラーの計算
  const validationError = useMemo(() => {
    if (error) return error;

    // 必須チェック
    if (block.validation.required) {
      const unselectedRows = block.validation.rows.filter(
        (row) => !value[row.id] || value[row.id] === "",
      );
      if (unselectedRows.length > 0) {
        return getRequiredMessage();
      }
    }

    // Choice grid allows only one selection per row, so no additional validation needed

    return null;
  }, [error, block, value, getRequiredMessage]);

  return (
    <ErrorBoundary>
      <div className={cn("space-y-3", className)}>
        {/* 質問ラベル */}
        {block.validation.required && (
          <Badge variant="destructive" className="w-fit">
            必須
          </Badge>
        )}
        <Label htmlFor={block.blockId} className="text-base font-medium">
          {block.title}
          {block.validation.required && (
            <span className="sr-only">（必須）</span>
          )}
        </Label>

        {/* 説明文 */}
        {block.description && (
          <p className="text-sm text-muted-foreground">{block.description}</p>
        )}

        {/* グリッド */}
        <div
          className={cn(
            "rounded-md border",
            validationError && "border-destructive",
          )}
        >
          <ChoiceGridTable
            block={block}
            value={value}
            disabled={disabled}
            onRowChange={handleRowChange}
          />
        </div>

        {/* Choice grid allows only one selection per row */}

        {/* エラーメッセージ */}
        {validationError && (
          <p
            id={`${block.blockId}-error`}
            className="text-sm text-destructive"
            role="alert"
          >
            {validationError}
          </p>
        )}
      </div>
    </ErrorBoundary>
  );
};

// memoでパフォーマンス最適化
export const ChoiceGridQuestionComponent = memo(
  ChoiceGridQuestionInner,
  (prevProps, nextProps) => {
    // 基本的なプロップの比較
    if (
      prevProps.block.blockId !== nextProps.block.blockId ||
      prevProps.error !== nextProps.error ||
      prevProps.disabled !== nextProps.disabled ||
      prevProps.className !== nextProps.className
    ) {
      return false;
    }

    // 値の比較（オブジェクトの深い比較）
    const prevValue = prevProps.value || {};
    const nextValue = nextProps.value || {};

    const prevValueKeys = Object.keys(prevValue);
    const nextValueKeys = Object.keys(nextValue);

    if (prevValueKeys.length !== nextValueKeys.length) {
      return false;
    }

    for (const key of prevValueKeys) {
      if (prevValue[key] !== nextValue[key]) {
        return false;
      }
    }

    // ブロックオブジェクトの詳細比較
    if (
      prevProps.block.type !== nextProps.block.type ||
      prevProps.block.title !== nextProps.block.title ||
      prevProps.block.description !== nextProps.block.description ||
      prevProps.block.order !== nextProps.block.order
    ) {
      return false;
    }

    // バリデーション設定の比較
    const prevValidation = prevProps.block.validation as {
      required: boolean;
      rows: unknown[];
      columns: unknown[];
    };
    const nextValidation = nextProps.block.validation as {
      required: boolean;
      rows: unknown[];
      columns: unknown[];
    };

    if (!prevValidation && !nextValidation) return true;
    if (!prevValidation || !nextValidation) return false;

    return (
      prevValidation.required === nextValidation.required &&
      deepEqual(prevValidation.rows, nextValidation.rows) &&
      deepEqual(prevValidation.columns, nextValidation.columns)
    );
  },
);

export { ChoiceGridQuestionComponent as default };
