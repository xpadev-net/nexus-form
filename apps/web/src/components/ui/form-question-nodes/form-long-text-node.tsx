import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Textarea } from "@/components/ui/textarea";
import { EditorControlsWrapper, TextLengthEditor } from "./editor-controls";
import {
  FormQuestionElement,
  getQuestionControlLabelProps,
  useFormQuestionErrorA11y,
} from "./form-question-base";

export const FormLongTextElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <LongTextInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <TextLengthEditor />
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

export function LongTextInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  if (!ctx) return null;
  const answer = ctx.getAnswer(blockId);
  return (
    <Textarea
      {...getQuestionControlLabelProps(blockId)}
      value={(answer?.value as string) ?? ""}
      onChange={(e) => ctx.setAnswer(blockId, { value: e.target.value })}
      placeholder="回答を入力してください"
      rows={4}
      {...errorA11y}
    />
  );
}
