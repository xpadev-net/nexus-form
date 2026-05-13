/**
 * Worker 用 Redis Pub/Sub パブリッシャー
 *
 * バリデーション結果の更新イベントを form:validation:{formId} チャネルに配信する
 */

import type { ValidationSSEEvent } from "@nexus-form/shared";
import { getValidationChannel } from "@nexus-form/shared";
import Redis from "ioredis";
import { getPublisherConnectionOptions } from "./redis";

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (publisher) {
    return publisher;
  }

  publisher = new Redis(getPublisherConnectionOptions());

  publisher.on("error", (err) => {
    console.error("[redis-publisher] connection error:", err.message);
  });

  return publisher;
}

/**
 * バリデーションステータス変更イベントを publish する
 *
 * publish 失敗時はログのみ出力し、メインのバリデーション処理に影響させない
 */
export async function publishValidationEvent(
  event: ValidationSSEEvent,
): Promise<void> {
  try {
    const redis = getPublisher();
    const channel = getValidationChannel(event.formId);
    await redis.publish(channel, JSON.stringify(event));
  } catch (error) {
    console.error(
      "[redis-publisher] failed to publish validation event:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
