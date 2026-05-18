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

/**
 * Maximum millisecond delay accepted by Node.js timers and
 * `AbortSignal.timeout()` before values can overflow or fire unexpectedly.
 */
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
} as const;

/**
 * Reads a positive integer environment variable.
 *
 * @param name - Environment variable name to read.
 * @param defaultValue - Fallback value used when the variable is missing or invalid.
 * @param max - Largest accepted value, inclusive.
 * @returns A valid positive integer, or `defaultValue` after logging a warning.
 *
 * Values must be integer milliseconds greater than zero. Empty, non-integer,
 * non-positive, and over-`max` values are treated as invalid.
 */
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

/**
 * Resolves the Discord API fetch timeout from `DISCORD_API_TIMEOUT_MS`.
 *
 * @returns Timeout in milliseconds, clamped to the configured minimum and
 * capped by `MAX_TIMER_MS`.
 *
 * Invalid or missing values fall back to the default. Values below the minimum
 * are clamped with a warning, for example `50` becomes `100`.
 */
export function getDiscordApiTimeoutMs(): number {
  const parsed = parsePositiveIntEnv(
    "DISCORD_API_TIMEOUT_MS",
    DISCORD_CONFIG_DEFAULTS.API_TIMEOUT,
    MAX_TIMER_MS,
  );
  if (parsed < DISCORD_CONFIG_DEFAULTS.MIN_API_TIMEOUT) {
    console.warn(
      `[discord-config] DISCORD_API_TIMEOUT_MS="${parsed}" is below the minimum of ${DISCORD_CONFIG_DEFAULTS.MIN_API_TIMEOUT}ms; clamping to ${DISCORD_CONFIG_DEFAULTS.MIN_API_TIMEOUT}ms`,
    );
    return DISCORD_CONFIG_DEFAULTS.MIN_API_TIMEOUT;
  }
  return parsed;
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
