/**
 * 画像処理設定の一元管理
 */
import { z } from "zod";

import { logWarn } from "../lib/logger";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE_MB = 10;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

export type SupportedImageMimeType =
  (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const DEFAULT_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const satisfies readonly SupportedImageMimeType[];

const imageMimeTypeSchema = z.enum(SUPPORTED_IMAGE_MIME_TYPES);

const imageTypeMetadata = {
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    sharpFormat: "jpeg",
  },
  "image/png": {
    extensions: [".png"],
    sharpFormat: "png",
  },
  "image/webp": {
    extensions: [".webp"],
    sharpFormat: "webp",
  },
  "image/gif": {
    extensions: [".gif"],
    sharpFormat: "gif",
  },
  "image/svg+xml": {
    extensions: [".svg"],
    sharpFormat: "svg",
  },
} as const satisfies Record<
  SupportedImageMimeType,
  {
    extensions: readonly string[];
    sharpFormat: string;
  }
>;

const positiveNumberEnv = (defaultValue: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : Number(trimmed);
  }, z.number().positive().default(defaultValue));

const positiveIntegerEnv = (defaultValue: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : Number(trimmed);
  }, z.number().int().positive().default(defaultValue));

const allowedImageTypesEnv = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    return trimmed
      .split(",")
      .map((type) => type.trim())
      .filter((type) => type.length > 0);
  },
  z
    .array(imageMimeTypeSchema)
    .min(1)
    .default([...DEFAULT_ALLOWED_IMAGE_TYPES]),
);

const rawImageEnvironmentSchema = z.object({
  MAX_FILE_SIZE_MB: positiveNumberEnv(DEFAULT_MAX_FILE_SIZE_MB),
  ALLOWED_IMAGE_TYPES: allowedImageTypesEnv,
  MAX_IMAGE_DIMENSION: positiveIntegerEnv(4096),
  MAX_IMAGE_PIXELS: positiveIntegerEnv(268_402_689),
  IMAGE_CONCURRENT_LIMIT: positiveIntegerEnv(3),
  IMAGE_RATE_LIMIT_GLOBAL: positiveIntegerEnv(3),
  IMAGE_RATE_LIMIT_WINDOW: positiveIntegerEnv(60 * 1000),
  IMAGE_RATE_LIMIT_PER_USER: positiveIntegerEnv(5),
  IMAGE_RATE_LIMIT_PER_USER_WINDOW: positiveIntegerEnv(60 * 1000),
  IMAGE_RATE_LIMIT_PER_IP: positiveIntegerEnv(10),
  IMAGE_RATE_LIMIT_PER_IP_WINDOW: positiveIntegerEnv(60 * 1000),
});

export interface ParseImageEnvironmentOptions {
  warnDeprecated?: boolean;
}

export interface ImageEnvironmentConfig {
  maxFileSizeMb: number;
  maxFileSizeBytes: number;
  allowedImageTypes: SupportedImageMimeType[];
  allowedExtensions: string[];
  allowSvg: boolean;
  supportedInputFormats: string[];
  maxDimension: number;
  maxPixels: number;
  concurrentLimit: number;
  rateLimit: {
    globalMaxRequests: number;
    windowMs: number;
    perUserMaxRequests: number;
    perUserWindowMs: number;
    perIpMaxRequests: number;
    perIpWindowMs: number;
  };
}

function hasEnvValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function getMaxFileSizeMbFromEnv(
  env: NodeJS.ProcessEnv,
  warnDeprecated: boolean,
): string | number | undefined {
  if (hasEnvValue(env.MAX_IMAGE_SIZE)) {
    const message = hasEnvValue(env.MAX_FILE_SIZE_MB)
      ? "MAX_IMAGE_SIZE is deprecated and ignored because MAX_FILE_SIZE_MB is set"
      : "MAX_IMAGE_SIZE is deprecated; use MAX_FILE_SIZE_MB instead";

    if (warnDeprecated) {
      logWarn(message, "config", {
        deprecatedEnv: "MAX_IMAGE_SIZE",
        replacementEnv: "MAX_FILE_SIZE_MB",
      });
    }
  }

  if (hasEnvValue(env.MAX_FILE_SIZE_MB)) {
    return env.MAX_FILE_SIZE_MB;
  }

  if (!hasEnvValue(env.MAX_IMAGE_SIZE)) {
    return undefined;
  }

  return Number(env.MAX_IMAGE_SIZE) / BYTES_PER_MEGABYTE;
}

export function parseImageEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: ParseImageEnvironmentOptions = {},
): ImageEnvironmentConfig {
  const parsed = rawImageEnvironmentSchema.parse({
    MAX_FILE_SIZE_MB: getMaxFileSizeMbFromEnv(
      env,
      options.warnDeprecated === true,
    ),
    ALLOWED_IMAGE_TYPES: env.ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_DIMENSION: env.MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS: env.MAX_IMAGE_PIXELS,
    IMAGE_CONCURRENT_LIMIT: env.IMAGE_CONCURRENT_LIMIT,
    IMAGE_RATE_LIMIT_GLOBAL: env.IMAGE_RATE_LIMIT_GLOBAL,
    IMAGE_RATE_LIMIT_WINDOW: env.IMAGE_RATE_LIMIT_WINDOW,
    IMAGE_RATE_LIMIT_PER_USER: env.IMAGE_RATE_LIMIT_PER_USER,
    IMAGE_RATE_LIMIT_PER_USER_WINDOW: env.IMAGE_RATE_LIMIT_PER_USER_WINDOW,
    IMAGE_RATE_LIMIT_PER_IP: env.IMAGE_RATE_LIMIT_PER_IP,
    IMAGE_RATE_LIMIT_PER_IP_WINDOW: env.IMAGE_RATE_LIMIT_PER_IP_WINDOW,
  });

  const allowedImageTypes = uniqueValues(parsed.ALLOWED_IMAGE_TYPES);
  const allowedExtensions = uniqueValues(
    allowedImageTypes.flatMap((type) => imageTypeMetadata[type].extensions),
  );
  const supportedInputFormats = uniqueValues(
    allowedImageTypes.map((type) => imageTypeMetadata[type].sharpFormat),
  );

  return {
    maxFileSizeMb: parsed.MAX_FILE_SIZE_MB,
    maxFileSizeBytes: Math.round(parsed.MAX_FILE_SIZE_MB * BYTES_PER_MEGABYTE),
    allowedImageTypes,
    allowedExtensions,
    allowSvg: allowedImageTypes.includes("image/svg+xml"),
    supportedInputFormats,
    maxDimension: parsed.MAX_IMAGE_DIMENSION,
    maxPixels: parsed.MAX_IMAGE_PIXELS,
    concurrentLimit: parsed.IMAGE_CONCURRENT_LIMIT,
    rateLimit: {
      globalMaxRequests: parsed.IMAGE_RATE_LIMIT_GLOBAL,
      windowMs: parsed.IMAGE_RATE_LIMIT_WINDOW,
      perUserMaxRequests: parsed.IMAGE_RATE_LIMIT_PER_USER,
      perUserWindowMs: parsed.IMAGE_RATE_LIMIT_PER_USER_WINDOW,
      perIpMaxRequests: parsed.IMAGE_RATE_LIMIT_PER_IP,
      perIpWindowMs: parsed.IMAGE_RATE_LIMIT_PER_IP_WINDOW,
    },
  };
}

export const IMAGE_ENV_CONFIG = parseImageEnvironment(process.env, {
  warnDeprecated: true,
});

export const IMAGE_UPLOAD_LIMITS = {
  MAX_FILE_SIZE: IMAGE_ENV_CONFIG.maxFileSizeBytes,
  ALLOWED_TYPES: IMAGE_ENV_CONFIG.allowedImageTypes,
  ALLOWED_EXTENSIONS: IMAGE_ENV_CONFIG.allowedExtensions,
  ALLOW_SVG: IMAGE_ENV_CONFIG.allowSvg,
} as const;

export const IMAGE_PROCESSING_LIMITS = {
  MAX_FILE_SIZE: IMAGE_ENV_CONFIG.maxFileSizeBytes,
  MAX_DIMENSION: IMAGE_ENV_CONFIG.maxDimension,
  MAX_PIXELS: IMAGE_ENV_CONFIG.maxPixels,
  CONCURRENT_LIMIT: IMAGE_ENV_CONFIG.concurrentLimit,
  SUPPORTED_INPUT_FORMATS: IMAGE_ENV_CONFIG.supportedInputFormats,
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
    MAX_REQUESTS: IMAGE_ENV_CONFIG.rateLimit.globalMaxRequests, // 画像処理は重い処理のため厳しく制限
    WINDOW_MS: IMAGE_ENV_CONFIG.rateLimit.windowMs, // 1分間
  },
  // ユーザー別制限
  PER_USER: {
    MAX_REQUESTS: IMAGE_ENV_CONFIG.rateLimit.perUserMaxRequests, // ユーザーあたりの制限
    WINDOW_MS: IMAGE_ENV_CONFIG.rateLimit.perUserWindowMs, // 1分間
  },
  // IP別制限
  PER_IP: {
    MAX_REQUESTS: IMAGE_ENV_CONFIG.rateLimit.perIpMaxRequests, // IPあたり
    WINDOW_MS: IMAGE_ENV_CONFIG.rateLimit.perIpWindowMs, // 1分間
  },
} as const;
