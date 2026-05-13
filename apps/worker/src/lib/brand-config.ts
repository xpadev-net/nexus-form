import { createBrandConfig } from "@nexus-form/shared";

export const brandConfig = createBrandConfig({
  appName: process.env.BRAND_APP_NAME,
  userAgent: process.env.BRAND_USER_AGENT,
  homepageUrl: process.env.BRAND_HOMEPAGE_URL,
});
