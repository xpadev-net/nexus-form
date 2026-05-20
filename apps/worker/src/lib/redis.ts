import type { RedisOptions } from "ioredis";

interface SentinelConfig {
  host: string;
  port: number;
}

/**
 * Redis 接続設定を取得する
 *
 * Sentinel → REDIS_URL → REDIS_HOST/REDIS_PORT の順にフォールバックし、
 * API 側の getRedisConnection() と同じインフラに接続する。
 */
function getConnectionOptions(): RedisOptions {
  // 1. Redis Sentinel
  const sentinelsEnv = process.env.REDIS_SENTINELS;
  const masterName = process.env.REDIS_SENTINEL_MASTER_NAME;

  if (sentinelsEnv && masterName) {
    const sentinels: SentinelConfig[] = sentinelsEnv
      .split(",")
      .map((addr) => {
        const [host, portStr] = addr.trim().split(":");
        return {
          host: host || "localhost",
          port: Number.parseInt(portStr || "26379", 10),
        };
      })
      .filter((s) => s.host && s.port);

    if (sentinels.length > 0) {
      return {
        sentinels,
        name: masterName,
        sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {}),
      };
    }
  }

  // 2. REDIS_URL
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      const isTls = url.protocol === "rediss:";
      return {
        host: url.hostname,
        port: Number.parseInt(url.port || "6379", 10),
        password: url.password || process.env.REDIS_PASSWORD || undefined,
        username: url.username || undefined,
        ...(isTls ? { tls: {} } : {}),
      };
    } catch {
      // Parse error, fall through
    }
  }

  // 3. REDIS_HOST / REDIS_PORT
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number.parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

/**
 * BullMQ Worker 用の接続設定
 */
export const redisConnection: RedisOptions = {
  ...getConnectionOptions(),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Publisher 用の接続設定を取得する
 *
 * BullMQ 固有の maxRetriesPerRequest: null を上書きする。
 */
export function getPublisherConnectionOptions(): RedisOptions {
  return {
    ...getConnectionOptions(),
    maxRetriesPerRequest: 3,
  };
}
