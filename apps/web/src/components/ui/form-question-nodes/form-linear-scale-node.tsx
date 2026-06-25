import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { Button } from "@/components/ui/button";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import {
  EditorControlsWrapper,
  LinearScaleSettingsEditor,
} from "./editor-controls";
import {
  FormQuestionElement,
  getQuestionAccessibleName,
  getQuestionLabelId,
  useFormQuestionErrorA11y,
  useFormQuestionValidationFeedback,
} from "./form-question-base";

export const FormLinearScaleElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <LinearScaleInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <LinearScaleSettingsEditor />
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

export function LinearScaleInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  const validationFeedback = useFormQuestionValidationFeedback(blockId);
  if (!ctx) return null;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { min?: number; max?: number; step?: number; minLabel?: string; maxLabel?: string }
    | undefined;
  const min = validation?.min ?? 1;
  const max = validation?.max ?? 5;
  const step = validation?.step ?? 1;
  const minLabel = validation?.minLabel;
  const maxLabel = validation?.maxLabel;
  const currentValue = answer?.value as number | undefined;
  const questionName = getQuestionAccessibleName(element);

  const steps: number[] = [];
  for (let i = min; i <= max; i += step) {
    steps.push(i);
  }

  return (
    <div
      className="space-y-2"
      role="group"
      aria-labelledby={getQuestionLabelId(blockId)}
      {...errorA11y}
    >
      <div className="flex items-center justify-between gap-2">
        {minLabel && (
          <span className="text-xs text-muted-foreground">{minLabel}</span>
        )}
        <div className="flex flex-wrap gap-2">
          {steps.map((value) => (
            <Button
              key={value}
              type="button"
              variant={currentValue === value ? "default" : "outline"}
              aria-label={`${questionName}: ${value}`}
              aria-pressed={currentValue === value}
              onClick={() => {
                const nextAnswer = { value };
                ctx.setAnswer(blockId, nextAnswer);
                validationFeedback.markTouched(nextAnswer);
              }}
              className="size-9 rounded-full p-0 shadow-none"
            >
              {value}
            </Button>
          ))}
        </div>
        {maxLabel && (
          <span className="text-xs text-muted-foreground">{maxLabel}</span>
        )}
      </div>
    </div>
  );
}
