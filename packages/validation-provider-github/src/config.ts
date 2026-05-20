export interface GitHubServiceConfig {
  appId: string;
  privateKey: string;
  installationId?: string;
  cacheExpiry?: number;
  apiTimeoutMs: number;
}

export const MAX_TIMER_MS = 2_147_483_647;

export const GITHUB_CONFIG_DEFAULTS = {
  CACHE_TIMEOUT: 3600,
  MIN_CACHE_TIMEOUT: 1000,
  API_TIMEOUT: 15_000,
  MIN_API_TIMEOUT: 100,
} as const;

function parsePositiveIntEnv(
  name: string,
  defaultValue: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    console.warn(
      `[github-config] ${name}="${raw}" is not a positive integer<=${max}; falling back to ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

export function getGitHubApiTimeoutMs(): number {
  const parsed = parsePositiveIntEnv(
    "GITHUB_API_TIMEOUT_MS",
    GITHUB_CONFIG_DEFAULTS.API_TIMEOUT,
    MAX_TIMER_MS,
  );
  if (parsed < GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT) {
    console.warn(
      `[github-config] GITHUB_API_TIMEOUT_MS="${parsed}" is below the minimum of ${GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT}ms; clamping to ${GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT}ms`,
    );
    return GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT;
  }
  return parsed;
}

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
    apiTimeoutMs: getGitHubApiTimeoutMs(),
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
  if (config.apiTimeoutMs < GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT) {
    errors.push(
      `apiTimeoutMs must be at least ${GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT}`,
    );
  }
  return { isValid: errors.length === 0, errors };
}
