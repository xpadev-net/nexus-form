import type {
  DateValidationConfig,
  LinearScaleValidationConfig,
  TimeValidationConfig,
} from "@/types/domain/form-block";

export const normalizeLinearScaleValidation = (
  current: LinearScaleValidationConfig,
  updates: Partial<LinearScaleValidationConfig>,
): LinearScaleValidationConfig => {
  const next: LinearScaleValidationConfig = {
    ...current,
    ...updates,
  };

  if (!Number.isFinite(next.min)) {
    next.min = current.min;
  }

  if (next.max < next.min) {
    next.max = next.min;
  }

  if (next.step < 1) {
    next.step = 1;
  }

  const range = next.max - next.min;
  if (range <= 0) {
    next.step = 1;
    return next;
  }

  if (next.step > range) {
    next.step = range;
  }

  if (range % next.step !== 0) {
    next.step = 1;
  }

  return next;
};

export const normalizeSelectionBounds = <
  T extends {
    min: number | undefined;
    max: number | undefined;
  },
>(
  values: T,
  changed: "min" | "max",
): T => {
  const { min, max } = values;

  if (
    typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max < min
  ) {
    if (changed === "min") {
      return {
        ...values,
        max: min,
      };
    }

    return {
      ...values,
      min: max,
    };
  }

  return values;
};

export const normalizeDateBounds = (
  current: DateValidationConfig,
  updates: Partial<DateValidationConfig>,
  changed: "min" | "max",
): DateValidationConfig => {
  const next: DateValidationConfig = {
    ...current,
    ...updates,
  };

  const { minDate, maxDate } = next;

  if (minDate && maxDate && maxDate < minDate) {
    if (changed === "min") {
      next.maxDate = minDate;
    } else {
      next.minDate = maxDate;
    }
  }

  return next;
};

export const normalizeTimeBounds = (
  current: TimeValidationConfig,
  updates: Partial<TimeValidationConfig>,
  changed: "min" | "max",
): TimeValidationConfig => {
  const next: TimeValidationConfig = {
    ...current,
    ...updates,
  };

  const { minTime, maxTime } = next;

  if (minTime && maxTime && maxTime < minTime) {
    if (changed === "min") {
      next.maxTime = minTime;
    } else {
      next.minTime = maxTime;
    }
  }

  return next;
};

export const parseOptionalInteger = (value: string): number | undefined => {
  if (value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
};
