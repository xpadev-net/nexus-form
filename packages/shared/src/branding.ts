import { z } from "zod";

const HexColorPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const SafeUrlSchema = z.union([
  z
    .string()
    .url()
    .refine((url) => url.startsWith("https://") || url.startsWith("http://"), {
      message: "URLはhttpまたはhttpsプロトコルを使用してください",
    }),
  z.literal(""),
]);

export const BrandConfigSchema = z.object({
  appName: z.string().min(1).default("Nexus Form"),
  primaryColor: z
    .string()
    .regex(HexColorPattern, "有効なHEXカラーコードを入力してください")
    .default("#2563eb"),
  secondaryColor: z
    .string()
    .regex(HexColorPattern, "有効なHEXカラーコードを入力してください")
    .default("#1e40af"),
  accentColor: z
    .string()
    .regex(HexColorPattern, "有効なHEXカラーコードを入力してください")
    .default("#7c3aed"),
  cookiePrefix: z.string().min(1).default("nexus-form"),
  userAgent: z.string().min(1).default("nexus-form/1.0"),
  homepageUrl: SafeUrlSchema.default(""),
  monitorUserAgent: z.string().min(1).default("nexus-form-monitor/1.0"),
  termsUrl: SafeUrlSchema.default(""),
  privacyUrl: SafeUrlSchema.default(""),
  copyright: z.string().default(""),
});

export type BrandConfig = z.infer<typeof BrandConfigSchema>;

export const DEFAULT_BRAND_CONFIG: BrandConfig = BrandConfigSchema.parse({});

/**
 * 環境変数等から読み取った部分的な設定をデフォルト値とマージしてBrandConfigを生成する。
 * undefined の項目はデフォルト値にフォールバックする。
 */
export function createBrandConfig(
  overrides: Partial<Record<keyof BrandConfig, string | undefined>>,
): BrandConfig {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== "") {
      filtered[key] = value;
    }
  }
  const result = BrandConfigSchema.safeParse(filtered);
  if (!result.success) {
    // Parse each key independently so only invalid fields fall back to defaults
    const partial: Record<string, string> = {};
    for (const [key, value] of Object.entries(filtered)) {
      const fieldSchema = (
        BrandConfigSchema.shape as Record<string, z.ZodTypeAny>
      )[key];
      if (fieldSchema?.safeParse(value).success) {
        partial[key] = value;
      } else {
        console.warn(`[BrandConfig] Invalid value for "${key}", using default`);
      }
    }
    return BrandConfigSchema.parse(partial);
  }
  return result.data;
}
