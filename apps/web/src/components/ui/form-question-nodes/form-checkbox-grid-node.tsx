import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useId } from "react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import {
  getGridCellAccessibleName,
  getGridItemDisplayLabel,
} from "./choice-labels";
import {
  EditorControlsWrapper,
  GridItemsEditor,
  GridSelectionLimitsEditor,
} from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

interface GridItemLike {
  id: string;
  label: string;
}

export const FormCheckboxGridElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <CheckboxGridInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <GridItemsEditor />
        <GridSelectionLimitsEditor />
      </EditorControlsWrapper>
    ) : undefined;
    return (
      <FormQuestionElement
        ref={ref}
        viewerControls={viewerControls}
        editorControls={editorControls}
        {...props}
      >
        {children}
      </FormQuestionElement>
    );
  },
);

export function CheckboxGridInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const inputIdPrefix = useId();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | {
        rows?: GridItemLike[];
        columns?: GridItemLike[];
        minSelectionsPerRow?: number;
        maxSelectionsPerRow?: number;
      }
    | undefined;
  const rows = validation?.rows ?? [];
  const columns = validation?.columns ?? [];
  const minPerRow = validation?.minSelectionsPerRow;
  const maxPerRow = validation?.maxSelectionsPerRow;
  const responses =
    (answer?.responses as Record<string, string[]>) ?? {};

  if (rows.length === 0 || columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        グリッドの行または列が設定されていません
      </p>
    );
  }

  const toggleCell = (rowId: string, columnId: string) => {
    const current = responses[rowId] ?? [];
    const next = current.includes(columnId)
      ? current.filter((id) => id !== columnId)
      : [...current, columnId];
    ctx.setAnswer(blockId, {
      responses: { ...responses, [rowId]: next },
    });
  };

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border px-3 py-2 text-left text-sm font-medium" />
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="border px-3 py-2 text-center text-sm font-medium"
                  scope="col"
                >
                  {getGridItemDisplayLabel(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const rowSelections = responses[row.id] ?? [];
              const rowAtMax =
                maxPerRow != null && rowSelections.length >= maxPerRow;
              return (
                <tr key={row.id}>
                  <th
                    className="border px-3 py-2 text-left text-sm font-medium"
                    scope="row"
                  >
                    {getGridItemDisplayLabel(row)}
                  </th>
                  {columns.map((col, columnIndex) => {
                    const isChecked = rowSelections.includes(col.id);
                    const disabled = !isChecked && rowAtMax;
                    const inputId = `${inputIdPrefix}-cell-${rowIndex}-${columnIndex}`;
                    return (
                      <td key={col.id} className="border p-0 text-center">
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "relative flex min-h-10 w-full min-w-12 items-center justify-center px-3 py-2",
                            disabled
                              ? "cursor-not-allowed"
                              : "cursor-pointer",
                          )}
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={isChecked}
                            disabled={disabled}
                            onChange={() => toggleCell(row.id, col.id)}
                            aria-label={getGridCellAccessibleName(row, col)}
                            className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                          />
                          <span
                            aria-hidden="true"
                            className={cn(
                              "inline-flex h-4 w-4 items-center justify-center rounded-sm border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                              isChecked
                                ? "border-primary bg-primary text-primary-foreground"
                                : disabled
                                  ? "border-input opacity-40"
                                  : "border-input peer-hover:border-primary/50",
                            )}
                          >
                            {isChecked && (
                              <svg
                                className="h-3 w-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            )}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(minPerRow != null || maxPerRow != null) && (
        <p className="text-xs text-muted-foreground">
          {minPerRow != null && maxPerRow != null
            ? `各行${minPerRow}〜${maxPerRow}個選択`
            : minPerRow != null
              ? `各行${minPerRow}個以上選択`
              : `各行${maxPerRow}個以下で選択`}
        </p>
      )}
    </div>
  );
}
