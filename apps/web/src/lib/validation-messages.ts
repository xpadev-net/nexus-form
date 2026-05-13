// Validation messages

const VALIDATION_MESSAGES: Record<string, string> = {
  REQUIRED: "この項目は必須です",
  MIN_LENGTH: "文字数が不足しています",
  MAX_LENGTH: "文字数が上限を超えています",
  PATTERN_MISMATCH: "入力形式が正しくありません",
  EMAIL_INVALID: "有効なメールアドレスを入力してください",
  INVALID_OPTION: "無効な選択肢です",
  INVALID_OPTIONS: "無効な選択肢が含まれています",
  OTHER_VALUE_REQUIRED: "その他の内容を入力してください",
  MIN_SELECTIONS: "選択数が不足しています",
  MAX_SELECTIONS: "選択数が上限を超えています",
  OUT_OF_RANGE: "範囲外の値です",
  INVALID_STEP: "無効な値です",
  INVALID_DATE_FORMAT: "有効な日付を入力してください",
  INVALID_TIME_FORMAT: "有効な時刻を入力してください",
  DATE_TOO_EARLY: "指定日以降の日付を入力してください",
  DATE_TOO_LATE: "指定日以前の日付を入力してください",
  TIME_TOO_EARLY: "指定時刻以降の時刻を入力してください",
  TIME_TOO_LATE: "指定時刻以前の時刻を入力してください",
};

/**
 * Get a validation message by code.
 */
export function getValidationMessage(code: string): string {
  return VALIDATION_MESSAGES[code] ?? "入力に問題があります";
}
