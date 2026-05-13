import {
  CUSTOM_TEMPLATE_ID,
  getPatternTemplatePlaceholder,
} from "@/lib/constants/validation-patterns";
import { PLACEHOLDER_MESSAGES } from "@/lib/validation/error-messages";
import type { ShortTextValidationConfig } from "@/types/domain/form-block";

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
