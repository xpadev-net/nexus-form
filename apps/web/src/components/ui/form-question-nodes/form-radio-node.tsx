import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EMPTY_OPTION_LABEL } from "@/lib/constants/form-question";
import {
  AllowOtherEditor,
  ChoiceOptionsEditor,
  EditorControlsWrapper,
} from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

interface OptionLike {
  id: string;
  label: string;
}

export const FormRadioElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <RadioInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <ChoiceOptionsEditor />
        <AllowOtherEditor />
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

function RadioInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { options?: OptionLike[]; allowOther?: boolean; otherLabel?: string }
    | undefined;
  const options = validation?.options ?? [];
  const allowOther = validation?.allowOther ?? false;
  const otherLabel = validation?.otherLabel || "その他";
  const selectedValue = (answer?.value as string) ?? "";
  const isOtherSelected = selectedValue === "other";

  if (options.length === 0 && !allowOther) {
    return (
      <p className="text-sm text-muted-foreground">選択肢がありません</p>
    );
  }

  return (
    <div className="space-y-2">
      <RadioGroup
        value={selectedValue}
        onValueChange={(value) =>
          ctx.setAnswer(blockId, {
            value,
            other_value: value === "other" ? (answer?.other_value as string) : undefined,
          })
        }
      >
        {options.map((option) => (
          <div key={option.id} className="flex items-center gap-2">
            <RadioGroupItem value={option.id} id={`${blockId}-${option.id}`} />
            <Label htmlFor={`${blockId}-${option.id}`} className="font-normal">
              {option.label || EMPTY_OPTION_LABEL}
            </Label>
          </div>
        ))}
        {allowOther && (
          <div className="flex items-center gap-2">
            <RadioGroupItem value="other" id={`${blockId}-other`} />
            <Label htmlFor={`${blockId}-other`} className="font-normal">
              {otherLabel}
            </Label>
          </div>
        )}
      </RadioGroup>
      {allowOther && isOtherSelected && (
        <Input
          value={(answer?.other_value as string) ?? ""}
          onChange={(e) =>
            ctx.setAnswer(blockId, {
              value: "other",
              other_value: e.target.value,
            })
          }
          placeholder={`${otherLabel}を入力`}
          className="ml-6"
        />
      )}
    </div>
  );
}
