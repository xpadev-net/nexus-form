import { isValidDiscordBotToken } from "./utils";

export interface DiscordConfig {
  botToken: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes: string[];
  intents: string[];
  retryAttempts: number;
  retryDelay: number;
  cacheTimeout: number;
  apiTimeout?: number;
}

export const MAX_TIMER_MS = 2_147_483_647;

export const DISCORD_CONFIG_DEFAULTS = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  CACHE_TIMEOUT: 300000,
  API_TIMEOUT: 10000,
  MIN_RETRY_ATTEMPTS: 1,
  MIN_RETRY_DELAY: 100,
  MIN_CACHE_TIMEOUT: 1000,
  MIN_API_TIMEOUT: 100,
} as const;

export const DEFAULT_DISCORD_CONFIG = {
  scopes: ["identify", "guilds", "guilds.members.read"],
  intents: ["Guilds", "GuildMembers", "GuildPresences"],
  retryAttempts: DISCORD_CONFIG_DEFAULTS.RETRY_ATTEMPTS,
  retryDelay: DISCORD_CONFIG_DEFAULTS.RETRY_DELAY,
  cacheTimeout: DISCORD_CONFIG_DEFAULTS.CACHE_TIMEOUT,
  apiTimeout: DISCORD_CONFIG_DEFAULTS.API_TIMEOUT,
} as const;

export function parsePositiveIntEnv(
  name: string,
  defaultValue: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    console.warn(
      `[discord-config] ${name}="${raw}" is not a positive integer<=${max}; falling back to ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

export function getDiscordApiTimeoutMs(): number {
  return Math.max(
    DISCORD_CONFIG_DEFAULTS.MIN_API_TIMEOUT,
    parsePositiveIntEnv(
      "DISCORD_API_TIMEOUT_MS",
      DISCORD_CONFIG_DEFAULTS.API_TIMEOUT,
      MAX_TIMER_MS,
    ),
  );
}

export function getDiscordConfig(): DiscordConfig {
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN is required");
  }

  return {
    botToken,
    clientId: process.env.DISCORD_CLIENT_ID || undefined,
    clientSecret: process.env.DISCORD_CLIENT_SECRET || undefined,
    redirectUri: process.env.DISCORD_REDIRECT_URI || undefined,
    scopes: process.env.DISCORD_SCOPES?.split(",") || [
      ...DEFAULT_DISCORD_CONFIG.scopes,
    ],
    intents: process.env.DISCORD_INTENTS?.split(",") || [
      ...DEFAULT_DISCORD_CONFIG.intents,
    ],
    retryAttempts: Math.max(
      DISCORD_CONFIG_DEFAULTS.MIN_RETRY_ATTEMPTS,
      parseInt(
        process.env.DISCORD_RETRY_ATTEMPTS ||
          String(DISCORD_CONFIG_DEFAULTS.RETRY_ATTEMPTS),
        10,
      ) || DISCORD_CONFIG_DEFAULTS.RETRY_ATTEMPTS,
    ),
    retryDelay: Math.max(
      DISCORD_CONFIG_DEFAULTS.MIN_RETRY_DELAY,
      parseInt(
        process.env.DISCORD_RETRY_DELAY ||
          String(DISCORD_CONFIG_DEFAULTS.RETRY_DELAY),
        10,
      ) || DISCORD_CONFIG_DEFAULTS.RETRY_DELAY,
    ),
    cacheTimeout: Math.max(
      DISCORD_CONFIG_DEFAULTS.MIN_CACHE_TIMEOUT,
      parseInt(
        process.env.DISCORD_CACHE_TIMEOUT ||
          String(DISCORD_CONFIG_DEFAULTS.CACHE_TIMEOUT),
        10,
      ) || DISCORD_CONFIG_DEFAULTS.CACHE_TIMEOUT,
    ),
    apiTimeout: getDiscordApiTimeoutMs(),
  };
}

export function validateDiscordConfig(config: DiscordConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.botToken) {
    errors.push("Bot token is required");
  } else if (!isValidDiscordBotToken(config.botToken)) {
    errors.push("Invalid bot token format");
  }

  if (config.retryAttempts < 0) {
    errors.push("Retry attempts must be non-negative");
  }

  if (config.retryDelay < 0) {
    errors.push("Retry delay must be non-negative");
  }

  if (config.cacheTimeout < 0) {
    errors.push("Cache timeout must be non-negative");
  }

  if (config.apiTimeout !== undefined && config.apiTimeout < 0) {
    errors.push("API timeout must be non-negative");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
