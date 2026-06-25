import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMPTY_OPTION_LABEL } from "@/lib/constants/form-question";
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
  useFormQuestionErrorA11y,
  useFormQuestionValidationFeedback,
} from "./form-question-base";

interface OptionLike {
  id: string;
  label: string;
}

export const FormDropdownElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <DropdownInput element={element} />
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

export function DropdownInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  const validationFeedback = useFormQuestionValidationFeedback(blockId);
  if (!ctx) return null;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { options?: OptionLike[]; allowOther?: boolean; otherLabel?: string }
    | undefined;
  const options = validation?.options ?? [];
  const allowOther = validation?.allowOther ?? false;
  const otherLabel = validation?.otherLabel || "その他";
  const selectedValue = (answer?.value as string) ?? "";
  const isOtherSelected = selectedValue === "other";
  const questionLabelId = getQuestionLabelId(blockId);
  const otherInputId = getQuestionControlId(blockId, "other-input");

  if (options.length === 0 && !allowOther) {
    return (
      <p className="text-sm text-muted-foreground">選択肢がありません</p>
    );
  }

  return (
    <div className="space-y-2">
      <Select
        value={selectedValue}
        onValueChange={(value) => {
          const nextAnswer = {
            value,
            other_value: value === "other" ? (answer?.other_value as string) : undefined,
          };
          ctx.setAnswer(blockId, nextAnswer);
          validationFeedback.notifyAnswerChange(nextAnswer);
        }}
      >
        <SelectTrigger
          id={getQuestionControlId(blockId)}
          aria-labelledby={questionLabelId}
          className="w-full"
          onBlur={() =>
            validationFeedback.markTouched({
              value: selectedValue,
              other_value: isOtherSelected
                ? (answer?.other_value as string)
                : undefined,
            })
          }
          {...errorA11y}
        >
          <SelectValue placeholder="選択してください" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label || EMPTY_OPTION_LABEL}
            </SelectItem>
          ))}
          {allowOther && (
            <SelectItem value="other">{otherLabel}</SelectItem>
          )}
        </SelectContent>
      </Select>
      {allowOther && isOtherSelected && (
        <div>
          <Label htmlFor={otherInputId} className="sr-only">
            {getQuestionValueAccessibleName(element, `${otherLabel}を入力`)}
          </Label>
          <Input
            id={otherInputId}
            name={`${blockId}-other`}
            value={(answer?.other_value as string) ?? ""}
            onChange={(e) => {
              const nextAnswer = {
                value: "other",
                other_value: e.target.value,
              };
              ctx.setAnswer(blockId, nextAnswer);
              validationFeedback.notifyAnswerChange(nextAnswer);
            }}
            onBlur={(e) =>
              validationFeedback.markTouched({
                value: "other",
                other_value: e.target.value,
              })
            }
            placeholder={`${otherLabel}を入力`}
            {...errorA11y}
          />
        </div>
      )}
    </div>
  );
}
