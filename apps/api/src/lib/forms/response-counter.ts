/**
 * フォーム回答数カウント機能
 * Redis キャッシュによる高速化を実装
 */

import { db } from "@nexus-form/database";
import { formResponse } from "@nexus-form/database/schema";
import { count, eq, inArray } from "drizzle-orm";
import { getRedisClient } from "../cache/redis-client";
import { logError, logInfo, logWarn } from "../logger";

/**
 * キャッシュのTTL（秒）
 * 5分間キャッシュを保持
 */
const CACHE_TTL = 300; // 5 minutes

/**
 * キャッシュキーのプレフィックス
 */
const CACHE_KEY_PREFIX = "form:response_count:";

/**
 * キャッシュキーを生成
 */
function getCacheKey(formId: string): string {
  return `${CACHE_KEY_PREFIX}${formId}`;
}

/**
 * フォームの回答数を取得（キャッシュ付き）
 */
export async function getResponseCount(formId: string): Promise<number> {
  const startTime = Date.now();

  try {
    // Redis が利用可能な場合はキャッシュをチェック
    const redis = getRedisClient();
    if (redis) {
      const cacheKey = getCacheKey(formId);
      const cachedCount = await redis.get(cacheKey);

      if (cachedCount !== null) {
        const cachedValue = Number.parseInt(cachedCount, 10);
        const duration = Date.now() - startTime;

        if (process.env.NODE_ENV === "development") {
          logInfo(
            `[ResponseCounter] Cache hit for form ${formId}: ${cachedValue} (${duration}ms)`,
            "api",
            {},
          );
        }

        return cachedValue;
      }
    }

    // キャッシュミスまたはRedis未設定の場合はデータベースから取得
    const countValue = await countResponsesFromDatabase(formId);
    const duration = Date.now() - startTime;

    if (process.env.NODE_ENV === "development") {
      logInfo(
        `[ResponseCounter] Database query for form ${formId}: ${countValue} (${duration}ms)`,
        "api",
        {},
      );
    }

    // Redis が利用可能な場合はキャッシュに保存
    if (redis) {
      const cacheKey = getCacheKey(formId);
      redis
        .setex(cacheKey, CACHE_TTL, countValue.toString())
        .catch((error: unknown) => {
          logError(
            `[ResponseCounter] Failed to cache count for form ${formId}:`,
            "api",
            { error: error },
          );
        });
    }

    // パフォーマンス要件チェック（100ms以内）
    if (duration > 100) {
      logWarn(
        `[ResponseCounter] Slow query detected for form ${formId}: ${duration}ms`,
        "api",
        {},
      );
    }

    return countValue;
  } catch (error) {
    logError(
      `[ResponseCounter] Error getting response count for form ${formId}:`,
      "api",
      { error: error },
    );
    // フォールバック: エラー時もデータベースから取得を試みる
    return countResponsesFromDatabase(formId);
  }
}

/**
 * データベースから直接回答数を取得
 */
async function countResponsesFromDatabase(formId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(formResponse)
    .where(eq(formResponse.formId, formId));

  return result?.count ?? 0;
}

/**
 * フォームの回答数キャッシュを無効化
 */
export async function invalidateResponseCountCache(
  formId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    const cacheKey = getCacheKey(formId);
    await redis.del(cacheKey);

    if (process.env.NODE_ENV === "development") {
      logInfo(
        `[ResponseCounter] Cache invalidated for form ${formId}`,
        "api",
        {},
      );
    }
  } catch (error) {
    logError(
      `[ResponseCounter] Failed to invalidate cache for form ${formId}:`,
      "api",
      { error: error },
    );
    // キャッシュ無効化の失敗は無視（最悪TTLで期限切れになる）
  }
}

/**
 * 複数フォームの回答数を一括取得
 */
export async function getBatchResponseCounts(
  formIds: string[],
): Promise<Record<string, number>> {
  if (formIds.length === 0) {
    return {};
  }

  const redis = getRedisClient();
  const result: Record<string, number> = {};
  const uncachedFormIds: string[] = [];

  // Redis が利用可能な場合はキャッシュから一括取得
  if (redis) {
    try {
      const cacheKeys = formIds.map((id) => getCacheKey(id));
      const cachedCounts = await redis.mget(...cacheKeys);

      for (let i = 0; i < formIds.length; i++) {
        const formId = formIds[i];
        const cachedCount = cachedCounts[i];

        if (formId === undefined) continue;

        if (cachedCount !== null && cachedCount !== undefined) {
          result[formId] = Number.parseInt(cachedCount, 10);
        } else {
          uncachedFormIds.push(formId);
        }
      }
    } catch (error) {
      logError(
        "[ResponseCounter] Redis mget failed, falling back to database:",
        "api",
        { error: error },
      );
      uncachedFormIds.push(...formIds);
    }
  } else {
    uncachedFormIds.push(...formIds);
  }

  // キャッシュミスのフォームをデータベースから取得
  if (uncachedFormIds.length > 0) {
    const counts = await db
      .select({
        formId: formResponse.formId,
        count: count(),
      })
      .from(formResponse)
      .where(inArray(formResponse.formId, uncachedFormIds))
      .groupBy(formResponse.formId);

    // 結果をマップに格納
    for (const row of counts) {
      result[row.formId] = row.count;
    }

    // キャッシュに存在しなかったフォームで回答数0のものも追加
    for (const formId of uncachedFormIds) {
      if (!(formId in result)) {
        result[formId] = 0;
      }
    }

    // Redis が利用可能な場合は取得した結果をキャッシュ
    if (redis) {
      const pipeline = redis.pipeline();
      for (const formId of uncachedFormIds) {
        const cacheKey = getCacheKey(formId);
        const countValue = result[formId];
        if (countValue !== undefined) {
          pipeline.setex(cacheKey, CACHE_TTL, countValue.toString());
        }
      }
      await pipeline.exec().catch((error: unknown) => {
        logError("[ResponseCounter] Failed to cache batch counts:", "api", {
          error: error,
        });
      });
    }
  }

  return result;
}

/**
 * キャッシュの統計情報を取得（デバッグ用）
 */
export async function getCacheStats(): Promise<{
  redisAvailable: boolean;
  cachedFormCount: number;
}> {
  const redis = getRedisClient();

  if (!redis) {
    return {
      redisAvailable: false,
      cachedFormCount: 0,
    };
  }

  try {
    const keys = await redis.keys(`${CACHE_KEY_PREFIX}*`);

    return {
      redisAvailable: true,
      cachedFormCount: keys.length,
    };
  } catch (error) {
    logError("[ResponseCounter] Failed to get cache stats:", "api", {
      error: error,
    });
    return {
      redisAvailable: true,
      cachedFormCount: 0,
    };
  }
}
