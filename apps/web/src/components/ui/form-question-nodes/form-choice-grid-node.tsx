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
} from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

interface GridItemLike {
  id: string;
  label: string;
}

export const FormChoiceGridElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <ChoiceGridInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <GridItemsEditor />
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

export function ChoiceGridInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const inputIdPrefix = useId();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { rows?: GridItemLike[]; columns?: GridItemLike[] }
    | undefined;
  const rows = validation?.rows ?? [];
  const columns = validation?.columns ?? [];
  const responses = (answer?.responses as Record<string, string>) ?? {};

  if (rows.length === 0 || columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        グリッドの行または列が設定されていません
      </p>
    );
  }

  const handleSelect = (rowId: string, columnId: string) => {
    ctx.setAnswer(blockId, {
      responses: { ...responses, [rowId]: columnId },
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              className="border px-3 py-2 text-left text-sm font-medium"
              scope="col"
            />
            {columns.map((col, columnIndex) => (
              <th
                key={col.id}
                id={`${inputIdPrefix}-column-${columnIndex}`}
                className="border px-3 py-2 text-center text-sm font-medium"
                scope="col"
              >
                {getGridItemDisplayLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id}>
              <th
                id={`${inputIdPrefix}-row-${rowIndex}`}
                className="border px-3 py-2 text-left text-sm font-medium"
                scope="row"
              >
                {getGridItemDisplayLabel(row)}
              </th>
              {columns.map((col, columnIndex) => {
                const checked = responses[row.id] === col.id;
                const inputId = `${inputIdPrefix}-cell-${rowIndex}-${columnIndex}`;
                return (
                  <td key={col.id} className="border p-0 text-center">
                    <label
                      htmlFor={inputId}
                      className="relative flex min-h-10 w-full min-w-12 cursor-pointer items-center justify-center px-3 py-2"
                    >
                      <input
                        id={inputId}
                        type="radio"
                        name={`${inputIdPrefix}-row-choice-${rowIndex}`}
                        checked={checked}
                        onChange={() => handleSelect(row.id, col.id)}
                        aria-label={getGridCellAccessibleName(row, col)}
                        aria-describedby={`${inputIdPrefix}-row-${rowIndex} ${inputIdPrefix}-column-${columnIndex}`}
                        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                          checked
                            ? "border-primary bg-primary"
                            : "border-input peer-hover:border-primary/50",
                        )}
                      >
                        {checked && (
                          <span className="h-2 w-2 rounded-full bg-primary-foreground" />
                        )}
                      </span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
