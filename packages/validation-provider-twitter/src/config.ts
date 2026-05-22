import { z } from "zod";

export interface TwitterConfig {
  bearerToken: string;
  apiVersion?: string;
  baseUrl?: string;
  timeout?: number;
  allowedBaseUrlHosts?: readonly string[];
}

export const TWITTER_CONFIG_DEFAULTS = {
  API_VERSION: "2",
  BASE_URL: "https://api.twitter.com",
  ALLOWED_BASE_URL_HOSTS: ["api.twitter.com"],
  TIMEOUT: 30000,
  MIN_TIMEOUT: 1000,
} as const;

const TwitterConfigSchema = z.object({
  bearerToken: z.string().trim().min(1, "Bearer token is required"),
  apiVersion: z.string().trim().min(1).optional(),
  baseUrl: z.string().url("Twitter base URL must be a valid URL").optional(),
  timeout: z.number().finite().nonnegative().optional(),
  allowedBaseUrlHosts: z.array(z.string().trim().min(1)).optional(),
});

function normalizeTwitterBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function validateTwitterBaseUrlHost(
  baseUrl: string,
  allowedHosts: readonly string[],
): string | undefined {
  const { hostname, protocol } = new URL(baseUrl);
  if (protocol !== "https:") {
    return "Twitter base URL must use HTTPS";
  }
  return allowedHosts.includes(hostname)
    ? undefined
    : `Twitter base URL host must be one of: ${allowedHosts.join(", ")}`;
}

export function assertTwitterBaseUrlConfig(baseUrl: string): string {
  const normalizedBaseUrl = normalizeTwitterBaseUrl(baseUrl);
  const parsedBaseUrl =
    TwitterConfigSchema.shape.baseUrl.safeParse(normalizedBaseUrl);
  if (!parsedBaseUrl.success) {
    throw new Error(
      `Invalid Twitter config: ${parsedBaseUrl.error.issues
        .map((issue) => issue.message)
        .join(", ")}`,
    );
  }

  const hostError = validateTwitterBaseUrlHost(
    normalizedBaseUrl,
    TWITTER_CONFIG_DEFAULTS.ALLOWED_BASE_URL_HOSTS,
  );
  if (hostError) {
    throw new Error(`Invalid Twitter config: ${hostError}`);
  }

  return normalizedBaseUrl;
}

export function assertTwitterEnvironmentConfig(): void {
  assertTwitterBaseUrlConfig(
    process.env.TWITTER_BASE_URL || TWITTER_CONFIG_DEFAULTS.BASE_URL,
  );
}

export function getTwitterConfig(): TwitterConfig {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    throw new Error("TWITTER_BEARER_TOKEN is required");
  }
  const baseUrl = assertTwitterBaseUrlConfig(
    process.env.TWITTER_BASE_URL || TWITTER_CONFIG_DEFAULTS.BASE_URL,
  );
  const timeout = Math.max(
    TWITTER_CONFIG_DEFAULTS.MIN_TIMEOUT,
    parseInt(
      process.env.TWITTER_TIMEOUT || String(TWITTER_CONFIG_DEFAULTS.TIMEOUT),
      10,
    ) || TWITTER_CONFIG_DEFAULTS.TIMEOUT,
  );
  const config = {
    bearerToken,
    apiVersion:
      process.env.TWITTER_API_VERSION || TWITTER_CONFIG_DEFAULTS.API_VERSION,
    baseUrl,
    timeout,
  };
  const validation = validateTwitterConfig(config);
  if (!validation.isValid) {
    throw new Error(`Invalid Twitter config: ${validation.errors.join(", ")}`);
  }
  return config;
}

export function validateTwitterConfig(config: TwitterConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const parsedConfig = TwitterConfigSchema.safeParse(config);

  if (!parsedConfig.success) {
    for (const issue of parsedConfig.error.issues) {
      errors.push(issue.message);
    }
  }

  if (parsedConfig.success && parsedConfig.data.baseUrl !== undefined) {
    const hostError = validateTwitterBaseUrlHost(
      parsedConfig.data.baseUrl,
      parsedConfig.data.allowedBaseUrlHosts ??
        TWITTER_CONFIG_DEFAULTS.ALLOWED_BASE_URL_HOSTS,
    );
    if (hostError) errors.push(hostError);
  }

  return { isValid: errors.length === 0, errors };
}
