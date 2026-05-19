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
import {
  DateFormat,
  type DateValidationConfig,
  TimeFormat,
  type TimeValidationConfig,
} from "@/types/domain/form-block";
import type { BlockValidationEditorInternalProps } from "./types";
import { normalizeDateBounds, normalizeTimeBounds } from "./utils";

export const DateValidationRenderer = <T extends "date" | "time">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minDateId = fieldId("min-date");
  const maxDateId = fieldId("max-date");
  const dateFormatId = fieldId("date-format");
  const minTimeId = fieldId("min-time");
  const maxTimeId = fieldId("max-time");
  const timeFormatId = fieldId("time-format");

  if (question.type === "date") {
    const dateValidation: DateValidationConfig = question.validation;

    const handleMinDateChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeDateBounds(
        dateValidation,
        { minDate: event.target.value || undefined },
        "min",
      );

      onValidationChange(next);
    };

    const handleMaxDateChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeDateBounds(
        dateValidation,
        { maxDate: event.target.value || undefined },
        "max",
      );

      onValidationChange(next);
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minDateId}>最小日付</Label>
            <Input
              id={minDateId}
              type="date"
              value={dateValidation.minDate || ""}
              onChange={handleMinDateChange}
              max={dateValidation.maxDate}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxDateId}>最大日付</Label>
            <Input
              id={maxDateId}
              type="date"
              value={dateValidation.maxDate || ""}
              onChange={handleMaxDateChange}
              min={dateValidation.minDate}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={dateFormatId}>日付形式</Label>
          <Select
            value={question.validation.format || "YYYY-MM-DD"}
            onValueChange={(value) => {
              onValidationChange({
                ...question.validation,
                format: DateFormat.parse(value),
              });
            }}
          >
            <SelectTrigger id={dateFormatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (question.type === "time") {
    const timeValidation: TimeValidationConfig = question.validation;

    const handleMinTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeTimeBounds(
        timeValidation,
        { minTime: event.target.value || undefined },
        "min",
      );

      onValidationChange(next);
    };

    const handleMaxTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeTimeBounds(
        timeValidation,
        { maxTime: event.target.value || undefined },
        "max",
      );

      onValidationChange(next);
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minTimeId}>最小時刻</Label>
            <Input
              id={minTimeId}
              type="time"
              value={timeValidation.minTime || ""}
              onChange={handleMinTimeChange}
              max={timeValidation.maxTime || undefined}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxTimeId}>最大時刻</Label>
            <Input
              id={maxTimeId}
              type="time"
              value={timeValidation.maxTime || ""}
              onChange={handleMaxTimeChange}
              min={timeValidation.minTime || undefined}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={timeFormatId}>時刻形式</Label>
          <Select
            value={question.validation.format || "24h"}
            onValueChange={(value) =>
              onValidationChange({
                ...question.validation,
                format: TimeFormat.parse(value),
              })
            }
          >
            <SelectTrigger id={timeFormatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24時間形式</SelectItem>
              <SelectItem value="12h">12時間形式</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return null;
};
