/**
 * API 用 Redis Pub/Sub パブリッシャー
 *
 * ブロック変更・セッション変更イベントを form:editor:{formId} チャネルに配信する
 */

import type { EditorSSEEvent } from "@nexus-form/shared";
import { getEditorChannel } from "@nexus-form/shared";
import Redis from "ioredis";
import { logError, logInfo } from "./logger";
import { getRedisConnection } from "./redis";

let publisher: Redis | null = null;
let hasLoggedInit = false;

function getPublisher(): Redis | null {
  if (publisher) {
    return publisher;
  }

  // Redis 環境変数が設定されていない場合は null を返す
  if (
    !process.env.REDIS_URL &&
    !process.env.REDIS_HOST &&
    !process.env.REDIS_SENTINELS
  ) {
    return null;
  }

  const { connection } = getRedisConnection();

  // BullMQ 向けの設定を publisher 向けに上書き
  const {
    maxRetriesPerRequest: _,
    enableOfflineQueue: __,
    ...rest
  } = connection;

  publisher = new Redis({
    ...rest,
    maxRetriesPerRequest: 3,
  });

  publisher.on("error", (err) => {
    logError("Redis publisher connection error", "service", {
      error: err.message,
    });
  });

  if (!hasLoggedInit) {
    hasLoggedInit = true;
    logInfo("Redis publisher initialized", "service", {});
  }

  return publisher;
}

/**
 * エディタイベント（ブロック変更・セッション変更）を publish する
 */
export async function publishEditorEvent(event: EditorSSEEvent): Promise<void> {
  try {
    const redis = getPublisher();
    if (!redis) return;
    const channel = getEditorChannel(event.formId);
    await redis.publish(channel, JSON.stringify(event));
  } catch (error) {
    logError("Failed to publish editor event", "service", {
      error: error instanceof Error ? error.message : String(error),
      eventType: event.type,
      formId: event.formId,
    });
  }
}

export async function closePublisher(): Promise<void> {
  if (!publisher) return;
  try {
    await publisher.quit();
  } finally {
    publisher = null;
    hasLoggedInit = false;
  }
}
