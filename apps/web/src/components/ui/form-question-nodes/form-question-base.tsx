import { cn, withRef } from "@udecode/cn";
import { isPlateQuestionType } from "@nexus-form/shared";
import type { TElement } from "platejs";
import { ElementApi } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import type { ReactNode } from "react";
import { questionTypeLabels } from "@/lib/constants/form-question";

export { questionTypeLabels };

const HEADING_TYPES = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

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

function getElementChildren(element: TElement): unknown[] {
  return Array.isArray(element.children) ? element.children : [];
}

function getQuestionNumberPrefix(children: unknown[]): string {
  const firstText = collectText(children[0]).trim();
  return /^Q\d+\.$/.test(firstText) ? `${firstText} ` : "";
}

function getHeadingQuestionText(children: unknown[]): string | undefined {
  let bestHeading: {
    headingIndex: number;
    text: string;
  } | null = null;

  for (const child of children) {
    if (!isObjectRecord(child)) continue;
    const type = child.type;
    if (typeof type !== "string") continue;
    const headingIndex = (HEADING_TYPES as readonly string[]).indexOf(type);
    if (headingIndex === -1) continue;
    const text = collectText(child).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (bestHeading === null || headingIndex < bestHeading.headingIndex) {
      bestHeading = { headingIndex, text };
    }
  }

  return bestHeading?.text;
}

function getFirstQuestionText(children: unknown[]): string | undefined {
  for (const child of children) {
    const text = collectText(child).replace(/\s+/g, " ").trim();
    if (!text || /^Q\d+\.$/.test(text)) continue;
    return text;
  }
  return undefined;
}

export function getQuestionAccessibleName(element: TElement): string {
  const children = getElementChildren(element);
  const questionNumberPrefix = getQuestionNumberPrefix(children);
  const title = getHeadingQuestionText(children) ?? getFirstQuestionText(children);
  return `${questionNumberPrefix}${title ?? ""}`.trim() || "無題の質問";
}

export function getQuestionLabelId(blockId: string): string {
  return `${blockId}-question-label`;
}

export function getQuestionControlId(
  blockId: string,
  suffix = "answer",
): string {
  return `${blockId}-${suffix}`;
}

interface QuestionControlLabelProps {
  id: string;
  name: string;
  "aria-labelledby": string;
}

export function getQuestionControlLabelProps(
  blockId: string,
): QuestionControlLabelProps {
  return {
    id: getQuestionControlId(blockId),
    name: blockId,
    "aria-labelledby": getQuestionLabelId(blockId),
  };
}

export function getQuestionValueAccessibleName(
  element: TElement,
  valueLabel: string,
): string {
  return `${getQuestionAccessibleName(element)}: ${valueLabel}`;
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
    const blockId =
      typeof element.blockId === "string" ? element.blockId : undefined;

    return (
      <PlateElement
        ref={ref}
        className={cn(
          "my-3 rounded-lg border border-border bg-card p-4 shadow-sm",
          className,
        )}
        data-form-question-id={blockId}
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
        {blockId && (
          <span
            id={getQuestionLabelId(blockId)}
            className="sr-only"
            contentEditable={false}
          >
            {getQuestionAccessibleName(element)}
          </span>
        )}

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
