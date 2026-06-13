import { cn, withRef } from "@udecode/cn";
import { isPlateQuestionType } from "@nexus-form/shared";
import type { TElement } from "platejs";
import { ElementApi } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import type { ReactNode } from "react";
import { questionTypeLabels } from "@/lib/constants/form-question";

export { questionTypeLabels };

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function collectText(node: unknown): string {
  if (!isObjectRecord(node)) {
    return "";
  }

  if (ElementApi.isElement(node)) {
    const { children } = node;
    if (!Array.isArray(children)) {
      return "";
    }
    return children.map(collectText).join("");
  }

  return typeof node.text === "string" ? node.text : "";
}

function isElementEmpty(element: TElement): boolean {
  return collectText(element).trim() === "";
}

export interface FormQuestionElementProps {
  /** Rendered below the editable children area in editor mode */
  editorControls?: ReactNode;
  /** Rendered below the editable children area in viewer mode */
  viewerControls?: ReactNode;
}

/**
 * Shared base component for all form question node elements.
 * Renders a card wrapper with:
 * - Editable rich text children (managed by Plate)
 * - Additional controls below (validation settings in editor, input UI in viewer)
 */
export const FormQuestionElement = withRef<
  typeof PlateElement,
  FormQuestionElementProps
>(
  (
    { children, className, editorControls, viewerControls, ...props },
    ref,
  ) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const typeLabel = isPlateQuestionType(element.type)
      ? questionTypeLabels[element.type]
      : element.type;
    const validation = element.validation as
      | { required?: boolean }
      | undefined;
    const isRequired = validation?.required ?? false;

    return (
      <PlateElement
        ref={ref}
        className={cn(
          "my-3 rounded-lg border border-border bg-card p-4 shadow-sm",
          className,
        )}
        {...props}
      >
        {/* Type badge */}
        <div
          className="mb-2 flex items-center gap-2"
          contentEditable={false}
        >
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {typeLabel}
          </span>
          {/* 隣接する種別バッジとスタイルを揃えるため、Badge コンポーネントではなくインラインのピルスタイルを使用 */}
          {isRequired && (
            <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              必須
            </span>
          )}
        </div>

        {/* Editable rich text children (title/description) */}
        <div className="relative min-w-0">
          {!readOnly && isElementEmpty(element) && (
            <span
              aria-hidden="true"
              role="presentation"
              className="pointer-events-none absolute top-0 left-0 select-none text-muted-foreground/60"
              contentEditable={false}
            >
              質問タイトルを入力...
            </span>
          )}
          {children}
        </div>

        {/* Non-editable controls area */}
        {!readOnly && editorControls && (
          <div className="mt-5 border-t pt-4" contentEditable={false}>
            {editorControls}
          </div>
        )}
        {readOnly && viewerControls && (
          <div className="mt-3 border-t pt-3" contentEditable={false}>
            {viewerControls}
          </div>
        )}
      </PlateElement>
    );
  },
);
