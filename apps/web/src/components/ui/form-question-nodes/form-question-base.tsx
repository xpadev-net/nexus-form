import { cn, withRef } from "@udecode/cn";
import type { TElement, TText } from "platejs";
import { ElementApi } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import type { ReactNode } from "react";

function collectText(node: TElement | TText): string {
  if (ElementApi.isElement(node)) {
    const children = node.children as (TElement | TText)[];
    return children.map(collectText).join("");
  }
  return node.text;
}

function isElementEmpty(element: TElement): boolean {
  return collectText(element).trim() === "";
}

export const questionTypeLabels: Record<string, string> = {
  form_short_text: "テキスト入力",
  form_long_text: "テキストエリア",
  form_radio: "ラジオボタン",
  form_checkbox: "チェックボックス",
  form_dropdown: "ドロップダウン",
  form_linear_scale: "スライダー",
  form_rating: "評価",
  form_choice_grid: "選択グリッド",
  form_checkbox_grid: "チェックグリッド",
  form_date: "日付入力",
  form_time: "時刻入力",
  form_section_separator: "セクション区切り",
};

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
    const typeLabel = questionTypeLabels[element.type] ?? element.type;
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
