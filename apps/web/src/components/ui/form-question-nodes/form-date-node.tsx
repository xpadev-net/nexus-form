import { withRef } from "@udecode/cn";
import { isIsoCalendarDate } from "@nexus-form/shared";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import { DateSettingsEditor, EditorControlsWrapper } from "./editor-controls";
import {
  FormQuestionElement,
  getFormQuestionTitleId,
  useFormQuestionErrorA11y,
} from "./form-question-base";

export const FormDateElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <DateInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <DateSettingsEditor />
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

function getDateAnswerValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isDateValueOutsideValidation(
  value: string,
  validation:
    | {
        minDate?: string;
        maxDate?: string;
      }
    | undefined,
): boolean {
  if (value === "") return false;
  if (!isIsoCalendarDate(value)) return true;
  if (validation?.minDate && value < validation.minDate) return true;
  if (validation?.maxDate && value > validation.maxDate) return true;
  return false;
}

export function DateInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  if (!ctx) return null;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | {
        minDate?: string;
        maxDate?: string;
      }
    | undefined;
  const value = getDateAnswerValue(answer?.value);
  const syncDateValue = (nextValue: string) => {
    ctx.setAnswer(blockId, { value: nextValue });
  };
  const isInvalid = isDateValueOutsideValidation(value, validation);

  return (
    <Input
      type="date"
      min={validation?.minDate}
      max={validation?.maxDate}
      value={value}
      aria-invalid={isInvalid || errorA11y["aria-invalid"] ? true : undefined}
      aria-labelledby={getFormQuestionTitleId(blockId)}
      aria-describedby={errorA11y["aria-describedby"]}
      onChange={(e) => syncDateValue(e.currentTarget.value)}
      onBlur={(e) => syncDateValue(e.currentTarget.value)}
    />
  );
}
