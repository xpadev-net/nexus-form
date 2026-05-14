import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AllowOtherEditor,
  ChoiceOptionsEditor,
  EditorControlsWrapper,
  SelectionLimitsEditor,
} from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

interface OptionLike {
  id: string;
  label: string;
}

export const FormCheckboxElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <CheckboxInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <ChoiceOptionsEditor />
        <SelectionLimitsEditor />
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

function CheckboxInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | {
        options?: OptionLike[];
        allowOther?: boolean;
        otherLabel?: string;
        minSelections?: number;
        maxSelections?: number;
      }
    | undefined;
  const options = validation?.options ?? [];
  const allowOther = validation?.allowOther ?? false;
  const otherLabel = validation?.otherLabel || "その他";
  const maxSelections = validation?.maxSelections;
  const minSelections = validation?.minSelections;
  const selected = (answer?.values as string[]) ?? [];
  const isOtherSelected = selected.includes("other");
  const atMax = maxSelections != null && selected.length >= maxSelections;

  if (options.length === 0 && !allowOther) {
    return (
      <p className="text-sm text-muted-foreground">選択肢がありません</p>
    );
  }

  const toggleOption = (optionId: string, checked: boolean) => {
    const next = checked
      ? [...selected, optionId]
      : selected.filter((id) => id !== optionId);
    ctx.setAnswer(blockId, {
      values: next,
      other_values: next.includes("other")
        ? (answer?.other_values as string[]) ?? []
        : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-3">
        {options.map((option) => {
          const isChecked = selected.includes(option.id);
          return (
            <div key={option.id} className="flex items-center gap-2">
              <Checkbox
                id={`${blockId}-${option.id}`}
                checked={isChecked}
                disabled={!isChecked && atMax}
                onCheckedChange={(checked) =>
                  toggleOption(option.id, checked === true)
                }
              />
              <Label htmlFor={`${blockId}-${option.id}`} className="font-normal">
                {option.label || "（空の選択肢）"}
              </Label>
            </div>
          );
        })}
        {allowOther && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${blockId}-other`}
              checked={isOtherSelected}
              disabled={!isOtherSelected && atMax}
              onCheckedChange={(checked) =>
                toggleOption("other", checked === true)
              }
            />
            <Label htmlFor={`${blockId}-other`} className="font-normal">
              {otherLabel}
            </Label>
          </div>
        )}
      </div>
      {allowOther && isOtherSelected && (
        <Input
          value={((answer?.other_values as string[]) ?? [])[0] ?? ""}
          onChange={(e) =>
            ctx.setAnswer(blockId, {
              values: selected,
              other_values: [e.target.value],
            })
          }
          placeholder={`${otherLabel}を入力`}
          className="ml-6"
        />
      )}
      {(minSelections != null || maxSelections != null) && (
        <p className="text-xs text-muted-foreground">
          {minSelections != null && maxSelections != null
            ? `${minSelections}〜${maxSelections}個選択`
            : minSelections != null
              ? `${minSelections}個以上選択`
              : `${maxSelections}個以下で選択`}
        </p>
      )}
    </div>
  );
}
