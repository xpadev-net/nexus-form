import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import { DateSettingsEditor, EditorControlsWrapper } from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

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

function DateInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | {
        minDate?: string;
        maxDate?: string;
      }
    | undefined;
  return (
    <Input
      type="date"
      min={validation?.minDate}
      max={validation?.maxDate}
      value={(answer?.value as string) ?? ""}
      onChange={(e) => ctx.setAnswer(blockId, { value: e.target.value })}
    />
  );
}
