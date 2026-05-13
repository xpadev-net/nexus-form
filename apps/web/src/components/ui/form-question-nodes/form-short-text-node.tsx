import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import {
  EditorControlsWrapper,
  ShortTextPatternEditor,
  TextLengthEditor,
} from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

export const FormShortTextElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <ShortTextInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <TextLengthEditor />
        <ShortTextPatternEditor />
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

function ShortTextInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { placeholder?: string }
    | undefined;
  return (
    <Input
      value={(answer?.value as string) ?? ""}
      onChange={(e) => ctx.setAnswer(blockId, { value: e.target.value })}
      placeholder={validation?.placeholder || "回答を入力してください"}
    />
  );
}
