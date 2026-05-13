import type { BrandConfig } from "@nexus-form/shared";
import { createBrandConfig } from "@nexus-form/shared";

/**
 * Docker コンテナ起動時に docker-entrypoint.sh が生成する
 * /env-config.js 経由で注入されるランタイム設定。
 */
const runtimeConfig: Partial<Record<keyof BrandConfig, string>> =
  ((window as unknown as Record<string, unknown>).__BRAND_CONFIG__ as Partial<
    Record<keyof BrandConfig, string>
  >) ?? {};

/**
 * ランタイム値 (Docker env) → ビルド時値 (import.meta.env) → デフォルト値
 * の優先順位でブランド設定を解決する。
 */
function pick(
  runtimeKey: keyof BrandConfig,
  buildTimeValue: string | undefined,
): string | undefined {
  const runtimeValue = runtimeConfig[runtimeKey];
  return runtimeValue !== undefined && runtimeValue !== ""
    ? runtimeValue
    : buildTimeValue;
}

export const brandConfig = createBrandConfig({
  appName: pick("appName", import.meta.env.VITE_BRAND_APP_NAME),
  primaryColor: pick("primaryColor", import.meta.env.VITE_BRAND_PRIMARY_COLOR),
  secondaryColor: pick(
    "secondaryColor",
    import.meta.env.VITE_BRAND_SECONDARY_COLOR,
  ),
  accentColor: pick("accentColor", import.meta.env.VITE_BRAND_ACCENT_COLOR),
  termsUrl: pick("termsUrl", import.meta.env.VITE_BRAND_TERMS_URL),
  privacyUrl: pick("privacyUrl", import.meta.env.VITE_BRAND_PRIVACY_URL),
  copyright: pick("copyright", import.meta.env.VITE_BRAND_COPYRIGHT),
  homepageUrl: pick("homepageUrl", import.meta.env.VITE_BRAND_HOMEPAGE_URL),
});
