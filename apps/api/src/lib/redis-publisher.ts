/**
 * API 用 Redis Pub/Sub パブリッシャー
 *
 * ブロック変更・セッション変更イベントを form:editor:{formId} チャネルに配信する
 */

import type { RedisPublisherClient } from "@nexus-form/integrations";
import { createRedisPublisher } from "@nexus-form/integrations";
import type { EditorSSEEvent, SseAccessRevokedEvent } from "@nexus-form/shared";
import { getEditorChannel, getValidationChannel } from "@nexus-form/shared";
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

/**
 * Notifies active SSE subscribers that a user's form access was revoked.
 *
 * Publishes to both editor and validation channels so open streams disconnect.
 */
export async function publishSseAccessRevoked(
  formId: string,
  userId: string,
): Promise<void> {
  const event: SseAccessRevokedEvent = {
    type: "sse_access_revoked",
    formId,
    userId,
    timestamp: new Date().toISOString(),
  };
  const payload = JSON.stringify(event);
  const client = createPublisherClient();
  if (!client) return;

  const channels = [getEditorChannel(formId), getValidationChannel(formId)];
  try {
    await Promise.all(
      channels.map((channel) => client.publish(channel, payload)),
    );
  } catch (error) {
    logError("Failed to publish SSE access revoke event", "service", {
      error: error instanceof Error ? error.message : String(error),
      formId,
      userId,
    });
  } finally {
    await client.quit().catch(() => undefined);
  }
}

export async function closePublisher(): Promise<void> {
  try {
    await editorEventPublisher.close();
  } finally {
    hasLoggedInit = false;
  }
}
