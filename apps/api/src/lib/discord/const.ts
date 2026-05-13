import { brandConfig } from "../brand-config";

const homepagePart = brandConfig.homepageUrl
  ? ` (${brandConfig.homepageUrl})`
  : "";

export const DISCORD_USER_AGENT = `${brandConfig.userAgent}${homepagePart}${process.env.npm_package_version ? ` (v${process.env.npm_package_version})` : ""}`;
