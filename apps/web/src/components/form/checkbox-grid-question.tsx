import { type FC, memo, useCallback, useMemo } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CheckboxGridFormBlock } from "@/types/domain/form-block";
import { ErrorBoundary } from "./error-boundary";
import { useValidationMessages } from "./hooks/useValidationMessages";

/**
 * CheckboxGridQuestionコンポーネントのProps
 */
interface CheckboxGridQuestionProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof CheckboxGridFormBlock>;
  /** 現在の値（行ID -> 列IDの配列のマッピング） */
  value?: Record<string, string[]>;
  /** 値が変更された時のコールバック */
  onChange: (value: Record<string, string[]>) => void;
  /** 外部から設定されるエラーメッセージ */
  error?: string;
  /** 無効化状態 */
  disabled?: boolean;
  /** 追加のCSSクラス */
  className?: string;
}

const EMPTY_CHECKBOX_GRID_VALUE: Record<string, string[]> = {};

interface CheckboxGridTableProps {
  block: z.infer<typeof CheckboxGridFormBlock>;
  value: Record<string, string[]>;
  disabled: boolean;
  onRowChange: (rowId: string, columnId: string, checked: boolean) => void;
}

const CheckboxGridTable: FC<CheckboxGridTableProps> = ({
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
          {block.validation.columns.map((column) => (
            <th
              key={column.id}
              className="border border-border p-2 text-center font-medium bg-muted/50"
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.validation.rows.map((row) => (
          <tr key={row.id}>
            <td className="border border-border p-2 font-medium bg-muted/30">
              {row.label}
            </td>
            {block.validation.columns.map((column) => {
              const rowValues = value[row.id] || [];
              const isChecked = rowValues.includes(column.id);
              const inputId = `${block.blockId}-${row.id}-${column.id}`;

              return (
                <td
                  key={column.id}
                  className="border border-border p-2 text-center"
                >
                  <Checkbox
                    id={inputId}
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      onRowChange(row.id, column.id, !!checked)
                    }
                    disabled={disabled}
                    aria-label={`${row.label} - ${column.label}`}
                    className="mx-auto"
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

interface CheckboxGridSelectionSummaryProps {
  value: Record<string, string[]>;
  maxSelectionsPerRow?: number;
}

const CheckboxGridSelectionSummary: FC<CheckboxGridSelectionSummaryProps> = ({
  value,
  maxSelectionsPerRow,
}) => {
  const totalSelected = Object.values(value).reduce(
    (sum, selections) => sum + selections.length,
    0,
  );

  if (totalSelected === 0) return null;

  return (
    <div className="text-sm text-muted-foreground">
      選択済み: {totalSelected}個
      {maxSelectionsPerRow && <span> / {maxSelectionsPerRow}個</span>}
    </div>
  );
};

/**
 * チェックボックスグリッド質問コンポーネント
 *
 * 機能:
 * - 行列形式の選択肢表示
 * - 各行で複数の選択肢を選択可能
 * - バリデーション機能
 * - アクセシビリティ対応
 * - レスポンシブデザイン
 * - パフォーマンス最適化（memo）
 *
 * @example
 * ```tsx
 * <CheckboxGridQuestion
 *   question={question}
 *   value={value}
 *   onChange={setValue}
 *   error={error}
 * />
 * ```
 */
const CheckboxGridQuestionInner: FC<CheckboxGridQuestionProps> = ({
  block,
  value = EMPTY_CHECKBOX_GRID_VALUE,
  onChange,
  error,
  disabled = false,
  className,
}) => {
  if (block.type !== "checkbox_grid") {
    throw new Error("Invalid block type for CheckboxGridQuestionComponent");
  }

  const { getRequiredMessage } = useValidationMessages();

  // 行の選択値変更ハンドラー
  const handleRowChange = useCallback(
    (rowId: string, columnId: string, checked: boolean) => {
      const currentRowValues = value[rowId] || [];
      let newRowValues: string[];

      if (checked) {
        // チェックされた場合、配列に追加
        newRowValues = [...currentRowValues, columnId];
      } else {
        // チェックが外された場合、配列から削除
        newRowValues = currentRowValues.filter((id) => id !== columnId);
      }

      const newValue = { ...value, [rowId]: newRowValues };
      onChange(newValue);
    },
    [value, onChange],
  );

  // バリデーションエラーの計算
  const validationError = useMemo(() => {
    if (error) return error;

    // 必須チェックまたは最小選択数チェック
    if (block.validation.required || block.validation?.minSelectionsPerRow) {
      const unselectedRows = block.validation.rows.filter(
        (row) => !value[row.id] || (value[row.id] ?? []).length === 0,
      );
      if (unselectedRows.length > 0) {
        if (block.validation.required) {
          return getRequiredMessage();
        }
        if (block.validation?.minSelectionsPerRow) {
          return `各行で最低${block.validation.minSelectionsPerRow}つの選択が必要です`;
        }
      }
    }

    // 最大選択数チェック（行ごと）
    if (block.validation?.maxSelectionsPerRow) {
      const overSelectedRows = block.validation.rows.filter(
        (row) =>
          value[row.id] &&
          block.validation.maxSelectionsPerRow !== undefined &&
          (value[row.id] ?? []).length > block.validation.maxSelectionsPerRow,
      );
      if (overSelectedRows.length > 0) {
        return `各行で最大${block.validation.maxSelectionsPerRow}つまで選択できます`;
      }
    }

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
          <CheckboxGridTable
            block={block}
            value={value}
            disabled={disabled}
            onRowChange={handleRowChange}
          />
        </div>

        {/* 選択状況 */}
        <CheckboxGridSelectionSummary
          value={value}
          maxSelectionsPerRow={block.validation?.maxSelectionsPerRow}
        />

        {/* バリデーション情報 */}
        <div className="space-y-1">
          {block.validation?.minSelectionsPerRow && (
            <p className="text-xs text-muted-foreground">
              最低選択数（行ごと）: {block.validation.minSelectionsPerRow}
            </p>
          )}
          {block.validation?.maxSelectionsPerRow && (
            <p className="text-xs text-muted-foreground">
              最大選択数（行ごと）: {block.validation.maxSelectionsPerRow}
            </p>
          )}
        </div>

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
export const CheckboxGridQuestionComponent = memo(CheckboxGridQuestionInner);
