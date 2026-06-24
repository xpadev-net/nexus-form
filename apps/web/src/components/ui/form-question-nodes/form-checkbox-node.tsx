import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getChoiceDisplayLabel } from "./choice-labels";
import {
  AllowOtherEditor,
  ChoiceOptionsEditor,
  EditorControlsWrapper,
  SelectionLimitsEditor,
} from "./editor-controls";
import {
  FormQuestionElement,
  getQuestionControlId,
  getQuestionLabelId,
  getQuestionValueAccessibleName,
  useFormQuestionErrorA11y,
} from "./form-question-base";

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

export function CheckboxInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  if (!ctx) return null;
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
  const otherInputId = getQuestionControlId(blockId, "other-input");

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

  const focusOption = (optionId: string) => {
    document.getElementById(optionId)?.focus();
  };

  return (
    <div
      className="space-y-2"
      role="group"
      aria-labelledby={getQuestionLabelId(blockId)}
      {...errorA11y}
    >
      <div className="grid gap-3">
        {options.map((option) => {
          const isChecked = selected.includes(option.id);
          const label = getChoiceDisplayLabel(option);
          const disabled = !isChecked && atMax;
          const optionId = `${blockId}-${option.id}`;
          return (
            <div
              key={option.id}
              className={cn(
                "flex min-h-10 w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 font-normal leading-5 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
                disabled
                  ? "cursor-not-allowed bg-muted/30 text-muted-foreground opacity-70"
                  : "cursor-pointer hover:border-primary/30 hover:bg-muted/50",
                isChecked &&
                  "border-primary/30 bg-primary/5 text-foreground opacity-100 hover:bg-primary/10",
              )}
              onClick={(event) => {
                if (disabled) {
                  event.preventDefault();
                  return;
                }
                focusOption(optionId);
                toggleOption(option.id, !isChecked);
              }}
            >
              <Checkbox
                id={optionId}
                checked={isChecked}
                disabled={disabled}
                aria-label={label}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(checked) =>
                  toggleOption(option.id, checked === true)
                }
              />
              <Label
                htmlFor={optionId}
                className={cn(
                  "flex-1 font-normal leading-5",
                  disabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                {label}
              </Label>
            </div>
          );
        })}
        {allowOther && (
          <div
            className={cn(
              "flex min-h-10 w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 font-normal leading-5 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
              !isOtherSelected && atMax
                ? "cursor-not-allowed bg-muted/30 text-muted-foreground opacity-70"
                : "cursor-pointer hover:border-primary/30 hover:bg-muted/50",
              isOtherSelected &&
                "border-primary/30 bg-primary/5 text-foreground opacity-100 hover:bg-primary/10",
            )}
            onClick={(event) => {
              if (!isOtherSelected && atMax) {
                event.preventDefault();
                return;
              }
              focusOption(`${blockId}-other`);
              toggleOption("other", !isOtherSelected);
            }}
          >
            <Checkbox
              id={`${blockId}-other`}
              checked={isOtherSelected}
              disabled={!isOtherSelected && atMax}
              aria-label={otherLabel}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={(checked) =>
                toggleOption("other", checked === true)
              }
            />
            <Label
              htmlFor={`${blockId}-other`}
              className={cn(
                "flex-1 font-normal leading-5",
                !isOtherSelected && atMax
                  ? "cursor-not-allowed"
                  : "cursor-pointer",
              )}
              onClick={(event) => event.stopPropagation()}
            >
              {otherLabel}
            </Label>
          </div>
        )}
      </div>
      {allowOther && isOtherSelected && (
        <div className="ml-6">
          <Label htmlFor={otherInputId} className="sr-only">
            {getQuestionValueAccessibleName(element, `${otherLabel}を入力`)}
          </Label>
          <Input
            id={otherInputId}
            name={`${blockId}-other`}
            value={((answer?.other_values as string[]) ?? [])[0] ?? ""}
            onChange={(e) =>
              ctx.setAnswer(blockId, {
                values: selected,
                other_values: [e.target.value],
              })
            }
            placeholder={`${otherLabel}を入力`}
          />
        </div>
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
