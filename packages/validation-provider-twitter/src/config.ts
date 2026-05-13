export interface TwitterConfig {
  bearerToken: string;
  apiVersion?: string;
  baseUrl?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export const TWITTER_CONFIG_DEFAULTS = {
  API_VERSION: "2",
  BASE_URL: "https://api.twitter.com",
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  MIN_TIMEOUT: 1000,
  MIN_RETRY_ATTEMPTS: 1,
  MIN_RETRY_DELAY: 100,
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
    retryAttempts: Math.max(
      TWITTER_CONFIG_DEFAULTS.MIN_RETRY_ATTEMPTS,
      parseInt(
        process.env.TWITTER_RETRY_ATTEMPTS ||
          String(TWITTER_CONFIG_DEFAULTS.RETRY_ATTEMPTS),
        10,
      ) || TWITTER_CONFIG_DEFAULTS.RETRY_ATTEMPTS,
    ),
    retryDelay: Math.max(
      TWITTER_CONFIG_DEFAULTS.MIN_RETRY_DELAY,
      parseInt(
        process.env.TWITTER_RETRY_DELAY ||
          String(TWITTER_CONFIG_DEFAULTS.RETRY_DELAY),
        10,
      ) || TWITTER_CONFIG_DEFAULTS.RETRY_DELAY,
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
  if (config.retryAttempts !== undefined && config.retryAttempts < 0)
    errors.push("Retry attempts must be non-negative");
  if (config.retryDelay !== undefined && config.retryDelay < 0)
    errors.push("Retry delay must be non-negative");
  return { isValid: errors.length === 0, errors };
}
