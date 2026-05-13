// Public form response types

/** Other option value (radio/dropdown) */
export interface OtherOptionValue {
  type: "other";
  value: string;
}

/** Checkbox with other option value */
export interface CheckboxWithOtherValue {
  type: "checkbox_other";
  values: string[];
  otherValue: string;
}

/**
 * Value type for question responses in the public form.
 * Varies based on question type:
 * - string: short_text, long_text, radio, dropdown, date, time
 * - number: linear_scale, rating
 * - string[]: checkbox (without "other")
 * - OtherOptionValue: radio/dropdown with "other" selection
 * - CheckboxWithOtherValue: checkbox with "other" selection and text
 * - Record<string, string>: choice_grid
 * - Record<string, string[]>: checkbox_grid
 */
export type QuestionResponseValue =
  | string
  | number
  | string[]
  | OtherOptionValue
  | CheckboxWithOtherValue
  | Record<string, string>
  | Record<string, string[]>;
