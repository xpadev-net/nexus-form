// Domain response types

/** Short text response */
interface ShortTextResponse {
  question_type: "short_text";
  value: string;
}

/** Long text response */
interface LongTextResponse {
  question_type: "long_text";
  value: string;
}

/** Radio response */
interface RadioResponse {
  question_type: "radio";
  value: string;
  other_value?: string;
}

/** Checkbox response */
interface CheckboxResponse {
  question_type: "checkbox";
  values: string[];
  other_values?: string[];
}

/** Dropdown response */
interface DropdownResponse {
  question_type: "dropdown";
  value: string;
  other_value?: string;
}

/** Linear scale response */
interface LinearScaleResponse {
  question_type: "linear_scale";
  value: number;
}

/** Rating response */
interface RatingResponse {
  question_type: "rating";
  value: number;
}

/** Choice grid response */
interface ChoiceGridResponse {
  question_type: "choice_grid";
  responses: Record<string, string>;
}

/** Checkbox grid response */
interface CheckboxGridResponse {
  question_type: "checkbox_grid";
  responses: Record<string, string[]>;
}

/** Date response */
interface DateQuestionResponse {
  question_type: "date";
  value: string;
}

/** Time response */
interface TimeQuestionResponse {
  question_type: "time";
  value: string;
}

/** Union of all response data types */
export type ResponseData =
  | ShortTextResponse
  | LongTextResponse
  | RadioResponse
  | CheckboxResponse
  | DropdownResponse
  | LinearScaleResponse
  | RatingResponse
  | ChoiceGridResponse
  | CheckboxGridResponse
  | DateQuestionResponse
  | TimeQuestionResponse;
