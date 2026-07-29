import { z } from "zod";

export const CAPTCHA_PROVIDERS = ["hcaptcha", "turnstile"] as const;

export const captchaProviderSchema = z.enum(CAPTCHA_PROVIDERS);

export type CaptchaProvider = z.infer<typeof captchaProviderSchema>;

export function parseCaptchaProvider(
  value: string | undefined,
): CaptchaProvider {
  const trimmedValue = value?.trim();
  return captchaProviderSchema.parse(trimmedValue || "hcaptcha");
}
