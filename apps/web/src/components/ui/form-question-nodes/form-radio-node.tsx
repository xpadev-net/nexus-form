import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getChoiceDisplayLabel } from "./choice-labels";
import {
  AllowOtherEditor,
  ChoiceOptionsEditor,
  EditorControlsWrapper,
} from "./editor-controls";
import {
  FormQuestionElement,
  getQuestionControlId,
  getQuestionLabelId,
  getQuestionValueAccessibleName,
} from "./form-question-base";

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

export function RadioInput({ element }: { element: TElement }) {
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
  const otherInputId = getQuestionControlId(blockId, "other-input");

  if (options.length === 0 && !allowOther) {
    return (
      <p className="text-sm text-muted-foreground">選択肢がありません</p>
    );
  }

  return (
    <div className="space-y-2">
      <RadioGroup
        aria-labelledby={getQuestionLabelId(blockId)}
        value={selectedValue}
        onValueChange={(value) =>
          ctx.setAnswer(blockId, {
            value,
            other_value: value === "other" ? (answer?.other_value as string) : undefined,
          })
        }
      >
        {options.map((option) => {
          const label = getChoiceDisplayLabel(option);
          return (
            <div key={option.id} className="flex items-center gap-2">
              <RadioGroupItem
                value={option.id}
                id={`${blockId}-${option.id}`}
                aria-label={label}
              />
              <Label
                htmlFor={`${blockId}-${option.id}`}
                className="font-normal"
              >
                {label}
              </Label>
            </div>
          );
        })}
        {allowOther && (
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="other"
              id={`${blockId}-other`}
              aria-label={otherLabel}
            />
            <Label htmlFor={`${blockId}-other`} className="font-normal">
              {otherLabel}
            </Label>
          </div>
        )}
      </RadioGroup>
      {allowOther && isOtherSelected && (
        <div className="ml-6">
          <Label htmlFor={otherInputId} className="sr-only">
            {getQuestionValueAccessibleName(element, `${otherLabel}を入力`)}
          </Label>
          <Input
            id={otherInputId}
            name={`${blockId}-other`}
            value={(answer?.other_value as string) ?? ""}
            onChange={(e) =>
              ctx.setAnswer(blockId, {
                value: "other",
                other_value: e.target.value,
              })
            }
            placeholder={`${otherLabel}を入力`}
          />
        </div>
      )}
    </div>
  );
}
