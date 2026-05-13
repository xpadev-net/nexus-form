export interface GitHubServiceConfig {
  appId: string;
  privateKey: string;
  installationId?: string;
  cacheExpiry?: number;
}

export const GITHUB_CONFIG_DEFAULTS = {
  CACHE_TIMEOUT: 3600,
  MIN_CACHE_TIMEOUT: 1000,
} as const;

export function getGitHubConfig(): GitHubServiceConfig {
  const appId = process.env.GITHUB_APP_ID;
  const rawPrivateKey = process.env.GITHUB_PRIVATE_KEY;
  const installationId = process.env.GITHUB_INSTALLATION_ID;

  if (!appId || !rawPrivateKey) {
    throw new Error(
      "GitHub configuration is required. Please set GITHUB_APP_ID and GITHUB_PRIVATE_KEY.",
    );
  }

  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");

  return {
    appId,
    privateKey,
    installationId,
    cacheExpiry: Math.max(
      GITHUB_CONFIG_DEFAULTS.MIN_CACHE_TIMEOUT,
      Number.parseInt(
        process.env.GITHUB_CACHE_EXPIRY ||
          String(GITHUB_CONFIG_DEFAULTS.CACHE_TIMEOUT),
        10,
      ) || GITHUB_CONFIG_DEFAULTS.CACHE_TIMEOUT,
    ),
  };
}

export function validateGitHubConfig(config: GitHubServiceConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.appId || !config.privateKey) {
    errors.push("appId and privateKey are required");
  } else {
    if (!/^\d+$/.test(config.appId)) {
      errors.push("appId must be a numeric string");
    }
    if (!config.privateKey.includes("-----BEGIN")) {
      errors.push("privateKey must be in PEM format");
    }
  }
  if (config.cacheExpiry !== undefined && config.cacheExpiry < 0) {
    errors.push("Cache expiry must be non-negative");
  }
  return { isValid: errors.length === 0, errors };
}
