import { cn, withRef } from "@udecode/cn";
import { isPlateQuestionType } from "@nexus-form/shared";
import type { TElement } from "platejs";
import { ElementApi } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { createContext, type ReactNode, use } from "react";
import type { AnswerEntry } from "@/contexts/form-response-context";
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

export function getFormQuestionTitleId(blockId: string): string {
  return `form-question-${blockId}-title`;
}

export function getQuestionControlId(
  blockId: string,
  suffix = "answer",
): string {
  return `${blockId}-${suffix}`;
}

export function getQuestionLabelId(blockId: string): string {
  return getFormQuestionTitleId(blockId);
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

export function getFormQuestionErrorId(blockId: string): string {
  return `form-question-${blockId}-error`;
}

interface FormQuestionA11yState {
  invalidQuestionIds: ReadonlySet<string>;
  errorMessagesByQuestionId: ReadonlyMap<string, string>;
  warningMessagesByQuestionId: ReadonlyMap<string, string>;
  markQuestionTouched: (questionId: string, answer?: AnswerEntry) => void;
  notifyQuestionAnswerChange: (questionId: string, answer: AnswerEntry) => void;
}

const emptyInvalidQuestionIds = new Set<string>();
const emptyErrorMessagesByQuestionId = new Map<string, string>();
const emptyWarningMessagesByQuestionId = new Map<string, string>();
const noopQuestionFeedback = () => {};

type FormQuestionFeedbackMessage = {
  kind: "error" | "warning";
  message: string;
};

const FormQuestionA11yContext = createContext<FormQuestionA11yState>({
  invalidQuestionIds: emptyInvalidQuestionIds,
  errorMessagesByQuestionId: emptyErrorMessagesByQuestionId,
  warningMessagesByQuestionId: emptyWarningMessagesByQuestionId,
  markQuestionTouched: noopQuestionFeedback,
  notifyQuestionAnswerChange: noopQuestionFeedback,
});

export function FormQuestionA11yProvider({
  children,
  errorMessagesByQuestionId = emptyErrorMessagesByQuestionId,
  warningMessagesByQuestionId = emptyWarningMessagesByQuestionId,
  invalidQuestionIds,
  markQuestionTouched = noopQuestionFeedback,
  notifyQuestionAnswerChange = noopQuestionFeedback,
}: {
  children: ReactNode;
  errorMessagesByQuestionId?: ReadonlyMap<string, string>;
  warningMessagesByQuestionId?: ReadonlyMap<string, string>;
  invalidQuestionIds: ReadonlySet<string>;
  markQuestionTouched?: (questionId: string, answer?: AnswerEntry) => void;
  notifyQuestionAnswerChange?: (questionId: string, answer: AnswerEntry) => void;
}) {
  return (
    <FormQuestionA11yContext.Provider
      value={{
        errorMessagesByQuestionId,
        warningMessagesByQuestionId,
        invalidQuestionIds,
        markQuestionTouched,
        notifyQuestionAnswerChange,
      }}
    >
      {children}
    </FormQuestionA11yContext.Provider>
  );
}

export function useFormQuestionErrorA11y(blockId: string): {
  "aria-describedby"?: string;
  "aria-invalid"?: true;
} {
  const { invalidQuestionIds, warningMessagesByQuestionId } = use(
    FormQuestionA11yContext,
  );
  if (invalidQuestionIds.has(blockId)) {
    return {
      "aria-describedby": getFormQuestionErrorId(blockId),
      "aria-invalid": true,
    };
  }
  if (!warningMessagesByQuestionId.has(blockId)) {
    return {};
  }
  return {
    "aria-describedby": getFormQuestionErrorId(blockId),
  };
}

function useFormQuestionFeedbackMessage(
  blockId: string | undefined,
): FormQuestionFeedbackMessage | undefined {
  const { errorMessagesByQuestionId, warningMessagesByQuestionId } = use(
    FormQuestionA11yContext,
  );
  if (!blockId) return undefined;
  const errorMessage = errorMessagesByQuestionId.get(blockId);
  if (errorMessage) return { kind: "error", message: errorMessage };
  const warningMessage = warningMessagesByQuestionId.get(blockId);
  if (warningMessage) return { kind: "warning", message: warningMessage };
  return undefined;
}

export function useFormQuestionErrorMessage(
  blockId: string | undefined,
): string | undefined {
  const { errorMessagesByQuestionId } = use(FormQuestionA11yContext);
  if (!blockId) return undefined;
  return errorMessagesByQuestionId.get(blockId);
}

export function useFormQuestionValidationFeedback(blockId: string): {
  markTouched: (answer?: AnswerEntry) => void;
  notifyAnswerChange: (answer: AnswerEntry) => void;
} {
  const { markQuestionTouched, notifyQuestionAnswerChange } = use(
    FormQuestionA11yContext,
  );
  return {
    markTouched: (answer) => markQuestionTouched(blockId, answer),
    notifyAnswerChange: (answer) =>
      notifyQuestionAnswerChange(blockId, answer),
  };
}

export function FormQuestionErrorMessage({
  questionId,
}: {
  questionId: string | undefined;
}) {
  const feedbackMessage = useFormQuestionFeedbackMessage(questionId);
  if (!questionId || !feedbackMessage) return null;
  return (
    <p
      className={cn(
        "mt-2 text-sm outline-none",
        feedbackMessage.kind === "error"
          ? "text-destructive"
          : "text-amber-700 dark:text-amber-400",
      )}
      data-question-error-for={
        feedbackMessage.kind === "error" ? questionId : undefined
      }
      data-question-warning-for={
        feedbackMessage.kind === "warning" ? questionId : undefined
      }
      id={getFormQuestionErrorId(questionId)}
      tabIndex={-1}
    >
      {feedbackMessage.message}
    </p>
  );
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
    const titleId = blockId ? getQuestionLabelId(blockId) : undefined;
    const titleText = getQuestionAccessibleName(element);
    const feedbackMessage = useFormQuestionFeedbackMessage(blockId);

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
        {titleId ? (
          <span contentEditable={false} hidden id={titleId}>
            {titleText}
          </span>
        ) : null}
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
        {readOnly && (viewerControls || feedbackMessage) && (
          <div
            className={cn("mt-3", viewerControls && "border-t pt-3")}
            contentEditable={false}
          >
            {viewerControls}
            <FormQuestionErrorMessage questionId={blockId} />
          </div>
        )}
      </PlateElement>
    );
  },
);
