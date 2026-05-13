/**
 * バリデーションエラーメッセージの定数
 */
export const VALIDATION_ERROR_MESSAGES = {
  // 文字数関連
  MIN_LENGTH: (min: number) => `${min}文字以上で入力してください`,
  MAX_LENGTH: (max: number) => `${max}文字以下で入力してください`,

  // 必須項目
  REQUIRED: "この項目は必須です",

  // パターンマッチ
  PATTERN_MISMATCH: "入力形式が正しくありません",

  // システムエラー
  VALIDATION_ERROR: "バリデーション中にエラーが発生しました",
} as const;

/**
 * プレースホルダーメッセージの定数
 */
export const PLACEHOLDER_MESSAGES = {
  MIN_LENGTH: (min: number) => `${min}文字以上で入力してください`,
  MAX_LENGTH: (max: number) => `${max}文字以下で入力してください`,
  PATTERN: "指定された形式で入力してください",
  REQUIRED: "必須項目です",
} as const;
