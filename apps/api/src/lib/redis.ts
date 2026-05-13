import type { RedisOptions } from "ioredis";
import { logError, logInfo } from "./logger";

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
 * BullMQ用の共通Redis接続設定
 *
 * Sentinel環境での接続を優先的にサポートし、直接接続にもフォールバック可能。
 */
export function getRedisConnection(): { connection: RedisOptions } {
  const bullmqOptions: Partial<RedisOptions> = {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    connectTimeout: 10000,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  };

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
          `Redis Sentinel mode: connecting via ${sentinels.length} sentinel(s) to master "${masterName}"`,
          {
            sentinels: sentinels.map((s) => `${s.host}:${s.port}`),
            masterName,
          },
        );

        return {
          connection: {
            ...bullmqOptions,
            sentinels,
            name: masterName,
            sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
            password: process.env.REDIS_PASSWORD || undefined,
            ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {}),
          },
        };
      }
    } catch (error) {
      logError(
        "Failed to parse REDIS_SENTINELS, falling back to direct connection",
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
        `Redis standalone mode: connecting to ${url.hostname}:${url.port || 6379}`,
        {
          host: url.hostname,
          port: url.port || 6379,
          tls: isTls,
        },
      );

      return {
        connection: {
          ...bullmqOptions,
          host: url.hostname,
          port: Number.parseInt(url.port || "6379", 10),
          password: url.password || undefined,
          username: url.username || undefined,
          ...(isTls ? { tls: {} } : {}),
        },
      };
    } catch (error) {
      logError(
        "Failed to parse REDIS_URL, using REDIS_HOST/REDIS_PORT",
        "service",
        { error },
      );
    }
  }

  // 3. REDIS_HOSTとREDIS_PORTによる直接接続
  const host = process.env.REDIS_HOST || "localhost";
  const port = Number.parseInt(process.env.REDIS_PORT || "6379", 10);

  logConnectionInfoOnce(
    `Redis standalone mode: connecting to ${host}:${port}`,
    {
      host,
      port,
    },
  );

  return {
    connection: {
      ...bullmqOptions,
      host,
      port,
      password: process.env.REDIS_PASSWORD || undefined,
    },
  };
}

/**
 * Redis接続設定の診断情報を取得
 */
export function getRedisConnectionInfo(): {
  mode: "sentinel" | "standalone";
  config: Record<string, unknown>;
} {
  const sentinelsEnv = process.env.REDIS_SENTINELS;
  const masterName = process.env.REDIS_SENTINEL_MASTER_NAME;

  if (sentinelsEnv && masterName) {
    const sentinels = sentinelsEnv
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
        mode: "sentinel",
        config: {
          sentinels: sentinels.map((s) => `${s.host}:${s.port}`),
          masterName,
          hasSentinelPassword: !!process.env.REDIS_SENTINEL_PASSWORD,
          hasPassword: !!process.env.REDIS_PASSWORD,
          tls: process.env.REDIS_TLS === "true",
        },
      };
    }
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      return {
        mode: "standalone",
        config: {
          host: url.hostname,
          port: url.port || 6379,
          hasPassword: !!url.password,
          tls: url.protocol === "rediss:",
        },
      };
    } catch {
      // Parse error, fall through
    }
  }

  const host = process.env.REDIS_HOST || "localhost";
  const port = Number.parseInt(process.env.REDIS_PORT || "6379", 10);

  return {
    mode: "standalone",
    config: {
      host,
      port,
      hasPassword: !!process.env.REDIS_PASSWORD,
    },
  };
}
