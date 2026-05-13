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
}

export const DISCORD_CONFIG_DEFAULTS = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  CACHE_TIMEOUT: 300000,
  MIN_RETRY_ATTEMPTS: 1,
  MIN_RETRY_DELAY: 100,
  MIN_CACHE_TIMEOUT: 1000,
} as const;

export const DEFAULT_DISCORD_CONFIG = {
  scopes: ["identify", "guilds", "guilds.members.read"],
  intents: ["Guilds", "GuildMembers", "GuildPresences"],
  retryAttempts: DISCORD_CONFIG_DEFAULTS.RETRY_ATTEMPTS,
  retryDelay: DISCORD_CONFIG_DEFAULTS.RETRY_DELAY,
  cacheTimeout: DISCORD_CONFIG_DEFAULTS.CACHE_TIMEOUT,
} as const;

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

  return {
    isValid: errors.length === 0,
    errors,
  };
}
