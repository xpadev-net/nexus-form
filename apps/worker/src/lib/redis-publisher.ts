/**
 * Worker 用 Redis Pub/Sub パブリッシャー
 *
 * バリデーション結果の更新イベントを form:validation:{formId} チャネルに配信する
 */

import type { RedisPublisherClient } from "@nexus-form/integrations";
import { createRedisPublisher } from "@nexus-form/integrations";
import type { ValidationSSEEvent } from "@nexus-form/shared";
import { getValidationChannel } from "@nexus-form/shared";
import Redis from "ioredis";
import { getPublisherConnectionOptions } from "./redis";

function createPublisherClient(): RedisPublisherClient {
  return new Redis(getPublisherConnectionOptions());
}

const validationEventPublisher = createRedisPublisher<ValidationSSEEvent>({
  createClient: createPublisherClient,
  resolveChannel: (event) => getValidationChannel(event.formId),
  onConnectionError: (error) => {
    console.error("[redis-publisher] connection error:", error.message);
  },
  onPublishError: (error) => {
    console.error(
      "[redis-publisher] failed to publish validation event:",
      error instanceof Error ? error.message : String(error),
    );
  },
  onCloseError: (error) => {
    console.error(
      "[redis-publisher] failed to close publisher:",
      error instanceof Error ? error.message : String(error),
    );
  },
  swallowCloseError: true,
});

/**
 * Pub/Sub 用 Redis publisher を閉じる。
 * グレースフルシャットダウン時に呼び、接続リークを防ぐ。
 */
export async function closePublisher(): Promise<void> {
  await validationEventPublisher.close();
}

/**
 * バリデーションステータス変更イベントを publish する
 *
 * publish 失敗時はログのみ出力し、メインのバリデーション処理に影響させない
 */
export async function publishValidationEvent(
  event: ValidationSSEEvent,
): Promise<void> {
  await validationEventPublisher.publish(event);
}
