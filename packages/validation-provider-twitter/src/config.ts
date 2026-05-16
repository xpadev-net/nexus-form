export interface TwitterConfig {
  bearerToken: string;
  apiVersion?: string;
  baseUrl?: string;
  timeout?: number;
}

export const TWITTER_CONFIG_DEFAULTS = {
  API_VERSION: "2",
  BASE_URL: "https://api.twitter.com",
  TIMEOUT: 30000,
  MIN_TIMEOUT: 1000,
} as const;

export function getTwitterConfig(): TwitterConfig {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    throw new Error("TWITTER_BEARER_TOKEN is required");
  }
  return {
    bearerToken,
    apiVersion:
      process.env.TWITTER_API_VERSION || TWITTER_CONFIG_DEFAULTS.API_VERSION,
    baseUrl: process.env.TWITTER_BASE_URL || TWITTER_CONFIG_DEFAULTS.BASE_URL,
    timeout: Math.max(
      TWITTER_CONFIG_DEFAULTS.MIN_TIMEOUT,
      parseInt(
        process.env.TWITTER_TIMEOUT || String(TWITTER_CONFIG_DEFAULTS.TIMEOUT),
        10,
      ) || TWITTER_CONFIG_DEFAULTS.TIMEOUT,
    ),
  };
}

export function validateTwitterConfig(config: TwitterConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.bearerToken) {
    errors.push("Bearer token is required");
  } else if (
    typeof config.bearerToken !== "string" ||
    config.bearerToken.trim().length === 0
  ) {
    errors.push("Bearer token must be a non-empty string");
  }
  if (config.timeout !== undefined && config.timeout < 0)
    errors.push("Timeout must be non-negative");
  return { isValid: errors.length === 0, errors };
}
