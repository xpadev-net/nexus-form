/**
 * Redis クライアント設定と管理（キャッシュ用）
 */

import type { RedisOptions } from "ioredis";
import Redis from "ioredis";
import { logError, logInfo } from "../logger";

let redisClient: Redis | null = null;
let hasLoggedConnectionInfo = false;

function logConnectionInfoOnce(
  message: string,
  details: Record<string, unknown>,
): void {
  if (hasLoggedConnectionInfo) {
    return;
  }
  hasLoggedConnectionInfo = true;
  logInfo(message, "service", details);
}

interface SentinelConfig {
  host: string;
  port: number;
}

/**
 * Redis クライアントを取得
 * シングルトンパターンで Redis 接続を管理
 */
export function getRedisClient(): Redis | null {
  if (redisClient) {
    return redisClient;
  }

  if (!isRedisAvailable()) {
    return null;
  }

  const redisOptions: Partial<RedisOptions> = {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError: (err) => {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
  };

  try {
    // 1. Redis Sentinel設定を優先的にチェック
    const sentinelsEnv = process.env.REDIS_SENTINELS;
    const masterName = process.env.REDIS_SENTINEL_MASTER_NAME;

    if (sentinelsEnv && masterName) {
      try {
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
          logConnectionInfoOnce(
            `Redis cache Sentinel mode: connecting via ${sentinels.length} sentinel(s) to master "${masterName}"`,
            {
              sentinels: sentinels.map((s) => `${s.host}:${s.port}`),
              masterName,
            },
          );

          redisClient = new Redis({
            ...redisOptions,
            sentinels,
            name: masterName,
            sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
            password: process.env.REDIS_PASSWORD || undefined,
            ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {}),
          });

          redisClient.on("error", (err) => {
            logError("Redis cache connection error", "service", { error: err });
          });

          return redisClient;
        }
      } catch (error) {
        logError(
          "Failed to parse REDIS_SENTINELS for cache, falling back to direct connection",
          "service",
          { error },
        );
      }
    }

    // 2. REDIS_URLによる直接接続
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const url = new URL(redisUrl);
        const isTls = url.protocol === "rediss:";

        logConnectionInfoOnce(
          `Redis cache standalone mode: connecting to ${url.hostname}:${url.port || 6379}`,
          {
            host: url.hostname,
            port: url.port || 6379,
            tls: isTls,
          },
        );

        redisClient = new Redis(redisUrl, {
          ...redisOptions,
          password: url.password
            ? undefined
            : process.env.REDIS_PASSWORD || undefined,
          ...(isTls ? { tls: {} } : {}),
        });

        redisClient.on("error", (err) => {
          logError("Redis cache connection error", "service", { error: err });
        });

        return redisClient;
      } catch (error) {
        logError(
          "Failed to parse REDIS_URL for cache, using REDIS_HOST/REDIS_PORT",
          "service",
          { error },
        );
      }
    }

    // 3. REDIS_HOSTとREDIS_PORTによる直接接続
    const host = process.env.REDIS_HOST || "localhost";
    const port = Number.parseInt(process.env.REDIS_PORT || "6379", 10);

    logConnectionInfoOnce(
      `Redis cache standalone mode: connecting to ${host}:${port}`,
      {
        host,
        port,
      },
    );

    redisClient = new Redis({
      ...redisOptions,
      host,
      port,
      password: process.env.REDIS_PASSWORD || undefined,
    });

    redisClient.on("error", (err) => {
      logError("Redis cache connection error", "service", { error: err });
    });

    return redisClient;
  } catch (error) {
    logError("Failed to create Redis cache client", "service", { error });
    return null;
  }
}

/**
 * Redis クライアントを閉じる
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Redis が利用可能かチェック
 */
export function isRedisAvailable(): boolean {
  if (process.env.REDIS_SENTINELS && process.env.REDIS_SENTINEL_MASTER_NAME) {
    return true;
  }
  if (process.env.REDIS_URL) {
    return true;
  }
  if (process.env.REDIS_HOST) {
    return true;
  }
  return false;
}
