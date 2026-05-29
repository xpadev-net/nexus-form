import type { BrandConfig } from "@nexus-form/shared";
import { createBrandConfig } from "@nexus-form/shared";
import { z } from "zod";

declare global {
  interface Window {
    __BRAND_CONFIG__?: unknown;
  }
}

const RuntimeBrandConfigSchema = z.object({
  appName: z.string().min(1).optional().catch(undefined),
  primaryColor: z.string().min(1).optional().catch(undefined),
  secondaryColor: z.string().min(1).optional().catch(undefined),
  accentColor: z.string().min(1).optional().catch(undefined),
  cookiePrefix: z.string().min(1).optional().catch(undefined),
  userAgent: z.string().min(1).optional().catch(undefined),
  homepageUrl: z.string().min(1).optional().catch(undefined),
  monitorUserAgent: z.string().min(1).optional().catch(undefined),
  termsUrl: z.string().min(1).optional().catch(undefined),
  privacyUrl: z.string().min(1).optional().catch(undefined),
  copyright: z.string().min(1).optional().catch(undefined),
});

function loadRuntimeConfig(): Partial<Record<keyof BrandConfig, string>> {
  if (typeof window === "undefined") return {};
  if (window.__BRAND_CONFIG__ === undefined) return {};

  const result = RuntimeBrandConfigSchema.safeParse(window.__BRAND_CONFIG__);
  if (result.success) return result.data;

  console.warn("[BrandConfig] Invalid runtime config, using build defaults");
  return {};
}

/**
 * Docker コンテナ起動時に docker-entrypoint.sh が生成する
 * /env-config.js 経由で注入されるランタイム設定。
 */
const runtimeConfig = loadRuntimeConfig();

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
