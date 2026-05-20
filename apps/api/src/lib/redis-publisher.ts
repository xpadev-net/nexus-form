/**
 * API 用 Redis Pub/Sub パブリッシャー
 *
 * ブロック変更・セッション変更イベントを form:editor:{formId} チャネルに配信する
 */

import type { RedisPublisherClient } from "@nexus-form/integrations";
import { createRedisPublisher } from "@nexus-form/integrations";
import type { EditorSSEEvent } from "@nexus-form/shared";
import { getEditorChannel } from "@nexus-form/shared";
import Redis from "ioredis";
import { logError, logInfo } from "./logger";
import { getRedisConnection } from "./redis";

let hasLoggedInit = false;

function createPublisherClient(): RedisPublisherClient | null {
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

  return new Redis({
    ...rest,
    maxRetriesPerRequest: 3,
  });
}

const editorEventPublisher = createRedisPublisher<EditorSSEEvent>({
  createClient: createPublisherClient,
  resolveChannel: (event) => getEditorChannel(event.formId),
  onConnectionError: (error) => {
    logError("Redis publisher connection error", "service", {
      error: error.message,
    });
  },
  onInit: () => {
    if (hasLoggedInit) return;
    hasLoggedInit = true;
    logInfo("Redis publisher initialized", "service", {});
  },
  onPublishError: (error, event) => {
    logError("Failed to publish editor event", "service", {
      error: error instanceof Error ? error.message : String(error),
      eventType: event.type,
      formId: event.formId,
    });
  },
});

/**
 * エディタイベント（ブロック変更・セッション変更）を publish する
 */
export async function publishEditorEvent(event: EditorSSEEvent): Promise<void> {
  await editorEventPublisher.publish(event);
}

export async function closePublisher(): Promise<void> {
  await editorEventPublisher.close();
  hasLoggedInit = false;
}
