/**
 * 正規表現パターンテンプレートの定義
 *
 * 短文入力のバリデーションで使用する正規表現パターンのテンプレートを定義します。
 * 各テンプレートには、パターン文字列、表示名、エラーメッセージ、プレースホルダー例が含まれます。
 */

export interface ValidationPatternTemplate {
  /** テンプレートの識別子 */
  id: string;
  /** 表示名 */
  displayName: string;
  /** 正規表現パターン */
  pattern?: string;
  /** 推奨される入力タイプ */
  inputType?: "text" | "email";
  /** エラーメッセージ */
  errorMessage: string;
  /** プレースホルダー例 */
  placeholder: string;
  /** 説明文 */
  description: string;
  /** 最小文字数（オプション） */
  minLength?: number;
  /** 最大文字数（オプション） */
  maxLength?: number;
  /** 対応する外部サービスプロバイダー */
  externalService?: string;
}

/**
 * 正規表現パターンテンプレートの定義
 */
export const VALIDATION_PATTERN_TEMPLATES: ValidationPatternTemplate[] = [
  {
    id: "url",
    displayName: "URL",
    pattern:
      "^https?://[\\w\\-]+(\\.[\\w\\-]+)+([\\w\\-\\.,@?^=%&:/~\\+#]*[\\w\\-\\@?^=%&/~\\+#])?$",
    errorMessage:
      "有効なURLを入力してください（http://またはhttps://で始まる）",
    placeholder: "https://example.com",
    description: "HTTP/HTTPSプロトコルを含むURL",
  },
  {
    id: "email",
    displayName: "メールアドレス",
    inputType: "email",
    errorMessage: "有効なメールアドレスを入力してください",
    placeholder: "user@example.com",
    description: "ブラウザのメール入力（type=email）で検証されます",
  },
  {
    id: "custom",
    displayName: "カスタム",
    pattern: "",
    errorMessage: "入力形式が正しくありません",
    placeholder: "正規表現を入力してください",
    description: "自由に正規表現を入力可能",
  },
];

/**
 * テンプレートIDからテンプレートを取得する関数
 */
export const getPatternTemplate = (
  id: string,
): ValidationPatternTemplate | undefined => {
  return VALIDATION_PATTERN_TEMPLATES.find((template) => template.id === id);
};

/**
 * テンプレートIDからプレースホルダーを取得するヘルパー
 */
export const getPatternTemplatePlaceholder = (
  id: string,
): string | undefined => {
  return getPatternTemplate(id)?.placeholder;
};

/**
 * カスタムテンプレートのID
 */
export const CUSTOM_TEMPLATE_ID = "custom";
