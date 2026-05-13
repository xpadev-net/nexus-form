/**
 * 画像処理設定の一元管理
 */

/**
 * 環境変数を安全に数値に変換する
 * @param envVar 環境変数の値
 * @param defaultValue デフォルト値
 * @returns 解析された数値またはデフォルト値
 */
const parseEnvNumber = (
  envVar: string | undefined,
  defaultValue: number,
): number => {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

export const IMAGE_PROCESSING_LIMITS = {
  MAX_FILE_SIZE: parseEnvNumber(process.env.MAX_IMAGE_SIZE, 1024 * 1024), // 1MB
  MAX_DIMENSION: parseEnvNumber(process.env.MAX_IMAGE_DIMENSION, 4096), // 4K
  MAX_PIXELS: parseEnvNumber(process.env.MAX_IMAGE_PIXELS, 268402689), // 約268MP
  CONCURRENT_LIMIT: parseEnvNumber(process.env.IMAGE_CONCURRENT_LIMIT, 3), // 並行処理制限
} as const;

export const DEFAULT_IMAGE_PROCESSING_CONFIG = {
  format: "webp" as const,
  quality: 80,
  maxWidth: 1920,
  maxHeight: 1080,
} as const;

export const THUMBNAIL_IMAGE_PROCESSING_CONFIG = {
  format: "webp" as const,
  quality: 70,
  maxWidth: 400,
  maxHeight: 400,
} as const;

export const RATE_LIMIT_CONFIG = {
  // グローバル制限（全ユーザー共通）
  GLOBAL: {
    MAX_REQUESTS: parseEnvNumber(process.env.IMAGE_RATE_LIMIT_GLOBAL, 3), // 画像処理は重い処理のため厳しく制限
    WINDOW_MS: parseEnvNumber(process.env.IMAGE_RATE_LIMIT_WINDOW, 60 * 1000), // 1分間
  },
  // ユーザー別制限
  PER_USER: {
    MAX_REQUESTS: parseEnvNumber(process.env.IMAGE_RATE_LIMIT_PER_USER, 5), // ユーザーあたりの制限
    WINDOW_MS: parseEnvNumber(
      process.env.IMAGE_RATE_LIMIT_PER_USER_WINDOW,
      60 * 1000,
    ), // 1分間
  },
  // IP別制限
  PER_IP: {
    MAX_REQUESTS: parseEnvNumber(process.env.IMAGE_RATE_LIMIT_PER_IP, 10), // IPあたりの制限
    WINDOW_MS: parseEnvNumber(
      process.env.IMAGE_RATE_LIMIT_PER_IP_WINDOW,
      60 * 1000,
    ), // 1分間
  },
} as const;
