import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CheckboxGridValidationConfig } from "@/types/domain/form-block";
import type { BlockValidationEditorInternalProps } from "./types";
import { normalizeSelectionBounds, parseOptionalInteger } from "./utils";

export const GridValidationRenderer = <
  T extends "choice_grid" | "checkbox_grid",
>({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minSelectionsPerRowId = fieldId("min-selections-per-row");
  const maxSelectionsPerRowId = fieldId("max-selections-per-row");
  const validation = question.validation;

  if (question.type === "checkbox_grid") {
    const checkboxGridValidation = validation as CheckboxGridValidationConfig;
    const handleMinPerRowChange = (event: ChangeEvent<HTMLInputElement>) => {
      const nextMin = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: nextMin,
          max: checkboxGridValidation.maxSelectionsPerRow,
        },
        "min",
      );

      onValidationChange({
        ...checkboxGridValidation,
        minSelectionsPerRow: normalized.min,
        maxSelectionsPerRow: normalized.max,
      });
    };

    const handleMaxPerRowChange = (event: ChangeEvent<HTMLInputElement>) => {
      const nextMax = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: checkboxGridValidation.minSelectionsPerRow,
          max: nextMax,
        },
        "max",
      );

      onValidationChange({
        ...checkboxGridValidation,
        minSelectionsPerRow: normalized.min,
        maxSelectionsPerRow: normalized.max,
      });
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minSelectionsPerRowId}>行あたり最小選択数</Label>
            <Input
              id={minSelectionsPerRowId}
              type="number"
              value={checkboxGridValidation.minSelectionsPerRow ?? ""}
              onChange={handleMinPerRowChange}
              placeholder="0"
              min={0}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxSelectionsPerRowId}>行あたり最大選択数</Label>
            <Input
              id={maxSelectionsPerRowId}
              type="number"
              value={checkboxGridValidation.maxSelectionsPerRow ?? ""}
              onChange={handleMaxPerRowChange}
              placeholder="無制限"
              min={Math.max(1, checkboxGridValidation.minSelectionsPerRow ?? 1)}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
};
