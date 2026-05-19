import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlockValidationEditorInternalProps } from "./types";
import { normalizeLinearScaleValidation } from "./utils";

export const ScaleValidationRenderer = <T extends "linear_scale" | "rating">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const scaleMinId = fieldId("scale-min");
  const scaleMaxId = fieldId("scale-max");
  const minLabelId = fieldId("min-label");
  const maxLabelId = fieldId("max-label");
  const stepId = fieldId("step");
  const maxRatingId = fieldId("max-rating");
  const ratingIconId = fieldId("rating-icon");

  if (question.type === "linear_scale") {
    const linearValidation = question.validation;

    const handleMinChange = (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) {
        onValidationChange(linearValidation);
        return;
      }

      onValidationChange(
        normalizeLinearScaleValidation(linearValidation, {
          min: parsed,
        }),
      );
    };

    const handleMaxChange = (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) {
        onValidationChange(linearValidation);
        return;
      }

      onValidationChange(
        normalizeLinearScaleValidation(linearValidation, {
          max: parsed,
        }),
      );
    };

    const handleStepChange = (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) {
        onValidationChange(linearValidation);
        return;
      }

      onValidationChange(
        normalizeLinearScaleValidation(linearValidation, {
          step: parsed,
        }),
      );
    };

    const maxStepRange = linearValidation.max - linearValidation.min;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={scaleMinId}>最小値</Label>
            <Input
              id={scaleMinId}
              type="number"
              value={linearValidation.min}
              onChange={handleMinChange}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={scaleMaxId}>最大値</Label>
            <Input
              id={scaleMaxId}
              type="number"
              value={linearValidation.max}
              onChange={handleMaxChange}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minLabelId}>最小値ラベル</Label>
            <Input
              id={minLabelId}
              value={linearValidation.minLabel || ""}
              onChange={(event) =>
                onValidationChange({
                  ...linearValidation,
                  minLabel: event.target.value || undefined,
                })
              }
              placeholder="例: 全く当てはまらない"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxLabelId}>最大値ラベル</Label>
            <Input
              id={maxLabelId}
              value={linearValidation.maxLabel || ""}
              onChange={(event) =>
                onValidationChange({
                  ...linearValidation,
                  maxLabel: event.target.value || undefined,
                })
              }
              placeholder="例: 非常に当てはまる"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={stepId}>ステップ</Label>
          <Input
            id={stepId}
            type="number"
            value={linearValidation.step || 1}
            onChange={handleStepChange}
            min={1}
            max={maxStepRange > 0 ? maxStepRange : undefined}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  if (question.type === "rating") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={maxRatingId}>最大評価</Label>
          <Input
            id={maxRatingId}
            type="number"
            value={question.validation.maxRating || 5}
            onChange={(e) =>
              onValidationChange({
                ...question.validation,
                maxRating: parseInt(e.target.value, 10) || 5,
              })
            }
            min="1"
            max="10"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={ratingIconId}>アイコン</Label>
          <Select
            value={question.validation.icon || "star"}
            onValueChange={(value) =>
              onValidationChange({
                ...question.validation,
                icon: value as "star" | "heart" | "thumbs",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id={ratingIconId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="star">星</SelectItem>
              <SelectItem value="heart">ハート</SelectItem>
              <SelectItem value="thumbs">サムズアップ</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return null;
};
