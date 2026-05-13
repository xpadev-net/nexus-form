/**
 * Short text placeholder resolution logic.
 *
 * This is a simplified port that inlines the minimal constants needed
 * from the validation-patterns and error-messages modules.
 */

/**
 * Minimal validation pattern templates (placeholder only)
 */
const PATTERN_TEMPLATE_PLACEHOLDERS: Record<string, string> = {
  url: "https://example.com",
  email: "user@example.com",
  phone: "090-1234-5678",
  postal_code: "123-4567",
  number: "123",
};

const CUSTOM_TEMPLATE_ID = "custom";

function getPatternTemplatePlaceholder(id: string): string | undefined {
  return PATTERN_TEMPLATE_PLACEHOLDERS[id];
}

/**
 * プレースホルダーメッセージの定数
 */
const PLACEHOLDER_MESSAGES = {
  MIN_LENGTH: (min: number) => `${min}文字以上で入力してください`,
  MAX_LENGTH: (max: number) => `${max}文字以下で入力してください`,
  PATTERN: "指定された形式で入力してください",
} as const;

interface ShortTextValidationConfig {
  patternTemplate?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  [key: string]: unknown;
}

interface ShortTextPlaceholderOptions {
  validation?: ShortTextValidationConfig;
  placeholder?: string;
}

/**
 * 短文入力のプレースホルダーを決定する
 * - テンプレートIDにプレースホルダーがあれば最優先
 * - 続いてバリデーション設定内のカスタムプレースホルダーを参照
 * - 呼び出し元から直接渡された値をフォールバックとして利用
 * - それ以外は従来の長さ/パターンメッセージを組み合わせる
 */
export const getShortTextPlaceholder = ({
  placeholder,
  validation,
}: ShortTextPlaceholderOptions): string => {
  const templateId = validation?.patternTemplate;
  if (templateId && templateId !== CUSTOM_TEMPLATE_ID) {
    const templatePlaceholder = getPatternTemplatePlaceholder(templateId);
    if (templatePlaceholder) {
      return templatePlaceholder;
    }
  }

  if (validation?.placeholder) {
    return validation.placeholder;
  }

  if (placeholder) {
    return placeholder;
  }

  const parts: string[] = [];
  if (validation?.minLength) {
    parts.push(PLACEHOLDER_MESSAGES.MIN_LENGTH(validation.minLength));
  }
  if (validation?.maxLength) {
    parts.push(PLACEHOLDER_MESSAGES.MAX_LENGTH(validation.maxLength));
  }
  if (validation?.pattern) {
    parts.push(PLACEHOLDER_MESSAGES.PATTERN);
  }

  return parts.length > 0 ? parts.join("、") : "入力してください";
};
