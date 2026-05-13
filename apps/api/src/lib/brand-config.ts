import { createBrandConfig } from "@nexus-form/shared";

export const brandConfig = createBrandConfig({
  appName: process.env.BRAND_APP_NAME,
  primaryColor: process.env.BRAND_PRIMARY_COLOR,
  secondaryColor: process.env.BRAND_SECONDARY_COLOR,
  accentColor: process.env.BRAND_ACCENT_COLOR,
  cookiePrefix: process.env.BRAND_COOKIE_PREFIX,
  userAgent: process.env.BRAND_USER_AGENT,
  homepageUrl: process.env.BRAND_HOMEPAGE_URL,
  monitorUserAgent: process.env.BRAND_MONITOR_USER_AGENT,
  termsUrl: process.env.BRAND_TERMS_URL,
  privacyUrl: process.env.BRAND_PRIVACY_URL,
  copyright: process.env.BRAND_COPYRIGHT,
});
