import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CheckboxValidationConfig } from "@/types/domain/form-block";
import type { BlockValidationEditorInternalProps } from "./types";
import { normalizeSelectionBounds, parseOptionalInteger } from "./utils";

export const ChoiceValidationRenderer = <
  T extends "checkbox" | "radio" | "dropdown",
>({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minSelectionsId = fieldId("min-selections");
  const maxSelectionsId = fieldId("max-selections");
  const allowOtherId = fieldId("allow-other");
  const otherLabelId = fieldId("other-label");

  const renderCheckboxRangeControls = () => {
    if (question.type !== "checkbox") {
      return null;
    }

    const checkboxValidation: CheckboxValidationConfig = question.validation;

    const handleMinSelectionsChange = (
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      const nextMin = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: nextMin,
          max: checkboxValidation.maxSelections,
        },
        "min",
      );

      onValidationChange({
        ...checkboxValidation,
        minSelections: normalized.min,
        maxSelections: normalized.max,
      });
    };

    const handleMaxSelectionsChange = (
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      const nextMax = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: checkboxValidation.minSelections,
          max: nextMax,
        },
        "max",
      );

      onValidationChange({
        ...checkboxValidation,
        minSelections: normalized.min,
        maxSelections: normalized.max,
      });
    };

    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={minSelectionsId}>最小選択数</Label>
          <Input
            id={minSelectionsId}
            type="number"
            value={checkboxValidation.minSelections ?? ""}
            onChange={handleMinSelectionsChange}
            placeholder="0"
            min={0}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={maxSelectionsId}>最大選択数</Label>
          <Input
            id={maxSelectionsId}
            type="number"
            value={checkboxValidation.maxSelections ?? ""}
            onChange={handleMaxSelectionsChange}
            placeholder="無制限"
            min={Math.max(1, checkboxValidation.minSelections ?? 1)}
            disabled={disabled}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {question.type === "checkbox" && renderCheckboxRangeControls()}

      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Switch
            id={allowOtherId}
            checked={question.validation.allowOther || false}
            onCheckedChange={(checked) =>
              onValidationChange({
                ...question.validation,
                allowOther: checked,
              })
            }
            disabled={disabled}
          />
          <Label htmlFor={allowOtherId}>「その他」オプションを追加</Label>
        </div>
        {question.validation.allowOther && (
          <div className="space-y-2">
            <Label htmlFor={otherLabelId}>「その他」ラベル</Label>
            <Input
              id={otherLabelId}
              value={question.validation.otherLabel || "その他"}
              onChange={(e) =>
                onValidationChange({
                  ...question.validation,
                  otherLabel: e.target.value,
                })
              }
              placeholder="その他"
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
};
