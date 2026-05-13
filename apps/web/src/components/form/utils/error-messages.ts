/**
 * Centralized error messages for form components
 * Provides consistent error messaging across all form components
 */

export const FormErrorMessages = {
  // Date validation errors
  DATE_INVALID_FORMAT: "日付の形式が正しくありません",
  DATE_INVALID_RANGE: "日付が指定された範囲外です",
  DATE_REQUIRED: "日付を入力してください",
  DATE_VALIDATION_ERROR: "日付の検証中にエラーが発生しました",

  // Time validation errors
  TIME_INVALID_FORMAT: "時刻の形式が正しくありません",
  TIME_INVALID_RANGE: "時刻が指定された範囲外です",
  TIME_REQUIRED: "時刻を入力してください",
  TIME_VALIDATION_ERROR: "時刻の検証中にエラーが発生しました",

  // Generic validation errors
  VALIDATION_IN_PROGRESS: "検証中...",
  VALIDATION_ERROR: "検証中にエラーが発生しました",
  VALIDATION_REQUIRED: "この項目は必須です",
  VALIDATION_INVALID_FORMAT: "形式が正しくありません",

  // Input masking errors
  INPUT_INVALID_CHARACTERS: "無効な文字が含まれています",
  INPUT_TOO_LONG: "入力が長すぎます",
  INPUT_TOO_SHORT: "入力が短すぎます",

  // Network/API errors
  NETWORK_ERROR: "ネットワークエラーが発生しました",
  API_ERROR: "サーバーエラーが発生しました",
  TIMEOUT_ERROR: "タイムアウトが発生しました",
} as const;

/**
 * Error message utility functions
 */
export const ErrorMessageUtils = {
  /**
   * Creates a specific validation error message
   */
  createValidationError: (field: string, error: string): string => {
    return `${field}の${error}`;
  },

  /**
   * Creates a range error message
   */
  createRangeError: (field: string, min: string, max: string): string => {
    return `${field}は${min}から${max}の間で入力してください`;
  },

  /**
   * Creates a format error message
   */
  createFormatError: (field: string, expectedFormat: string): string => {
    return `${field}は${expectedFormat}形式で入力してください`;
  },

  /**
   * Creates a required field error message
   */
  createRequiredError: (field: string): string => {
    return `${field}は必須項目です`;
  },
} as const;

/**
 * Type for error message keys
 */
export type FormErrorKey = keyof typeof FormErrorMessages;
