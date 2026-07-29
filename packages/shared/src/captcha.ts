import { z } from "zod";

/**
 * CAPTCHA providerとしてサポートする値の一覧。
 * フロントエンド・バックエンド・環境変数チェックで同じ候補を参照します。
 */
export const CAPTCHA_PROVIDERS = ["hcaptcha", "turnstile"] as const;

/**
 * CAPTCHA provider値を検証する共有スキーマ。
 * 環境変数やruntime configのprovider検証に使用します。
 */
export const captchaProviderSchema = z.enum(CAPTCHA_PROVIDERS);

export type CaptchaProvider = z.infer<typeof captchaProviderSchema>;

/**
 * CAPTCHA provider環境変数を解析します。
 * 未指定または空文字の場合は"hcaptcha"を返し、不正値ではZodErrorをthrowします。
 */
export function parseCaptchaProvider(
  value: string | undefined,
): CaptchaProvider {
  const trimmedValue = value?.trim();
  return captchaProviderSchema.parse(trimmedValue || "hcaptcha");
}
