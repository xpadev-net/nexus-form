import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { Button } from "@/components/ui/button";
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
            <th className="border px-3 py-2 text-left text-sm font-medium" />
            {columns.map((col) => (
              <th
                key={col.id}
                className="border px-3 py-2 text-center text-sm font-medium"
              >
                {getGridItemDisplayLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="border px-3 py-2 text-sm font-medium">
                {getGridItemDisplayLabel(row)}
              </td>
              {columns.map((col) => (
                <td key={col.id} className="border px-3 py-2 text-center">
                  <Button
                    type="button"
                    role="radio"
                    aria-checked={responses[row.id] === col.id}
                    variant="ghost"
                    onClick={() => handleSelect(row.id, col.id)}
                    className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full border p-0 transition-colors",
                      responses[row.id] === col.id
                        ? "border-primary bg-primary hover:bg-primary hover:text-primary-foreground dark:hover:bg-primary"
                        : "border-input hover:border-primary/50 hover:bg-transparent dark:hover:bg-transparent",
                    )}
                    aria-label={getGridCellAccessibleName(row, col)}
                  >
                    {responses[row.id] === col.id && (
                      <span className="h-2 w-2 rounded-full bg-primary-foreground" />
                    )}
                  </Button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
