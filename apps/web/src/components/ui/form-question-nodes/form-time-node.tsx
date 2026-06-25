import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import { EditorControlsWrapper, TimeSettingsEditor } from "./editor-controls";
import {
  FormQuestionElement,
  getQuestionControlLabelProps,
  useFormQuestionErrorA11y,
  useFormQuestionValidationFeedback,
} from "./form-question-base";

export const FormTimeElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <TimeInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <TimeSettingsEditor />
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

export function TimeInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  const validationFeedback = useFormQuestionValidationFeedback(blockId);
  if (!ctx) return null;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | {
        minTime?: string;
        maxTime?: string;
      }
    | undefined;
  return (
    <Input
      {...getQuestionControlLabelProps(blockId)}
      type="time"
      min={validation?.minTime}
      max={validation?.maxTime}
      value={(answer?.value as string) ?? ""}
      {...errorA11y}
      onChange={(e) => {
        const nextAnswer = { value: e.target.value };
        ctx.setAnswer(blockId, nextAnswer);
        validationFeedback.notifyAnswerChange(nextAnswer);
      }}
      onBlur={(e) => validationFeedback.markTouched({ value: e.target.value })}
    />
  );
}
