/**
 * SSE (Server-Sent Events) エンドポイント
 *
 * Redis Pub/Sub をバックエンドとして、フォーム関連のリアルタイムイベントを配信する
 * - GET /:id/responses/events — バリデーション結果の更新 (form:validation:{formId})
 * - GET /:id/editor/events — ブロック・セッション変更 (form:editor:{formId})
 */

import { getEditorChannel, getValidationChannel } from "@nexus-form/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import Redis from "ioredis";
import { withDualFormAuth } from "../lib/dual-auth";
import { createHonoApp, type Env } from "../lib/hono";
import { getRedisConnection } from "../lib/redis";

const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * SSE 同時接続数の上限管理
 */
const MAX_SSE_CONNECTIONS = Number.parseInt(
  process.env.SSE_MAX_CONNECTIONS || "200",
  10,
);
let activeConnections = 0;

/**
 * Redis subscriber 用の接続オプションを取得する
 *
 * getRedisConnection() のパターンを活用し、Sentinel・TLS をサポートする。
 * BullMQ 固有の maxRetriesPerRequest: null は subscriber には不要なので上書きする。
 */
function createSubscriber(): Redis {
  const { connection } = getRedisConnection();

  // BullMQ 向けの設定を subscriber 向けに上書き
  const {
    maxRetriesPerRequest: _,
    enableOfflineQueue: __,
    ...rest
  } = connection;

  return new Redis({
    ...rest,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
  });
}

/**
 * SSE ストリームを作成する共通ヘルパー
 */
function createSSEStream(c: Context<Env>, channel: string) {
  // 接続数上限チェック
  if (activeConnections >= MAX_SSE_CONNECTIONS) {
    return c.text("Too many SSE connections", 503);
  }

  return streamSSE(c, async (stream) => {
    activeConnections++;
    let subscriber: Redis | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    try {
      subscriber = createSubscriber();

      let eventId = 0;

      // Redis メッセージ受信時に SSE イベントとして送信
      subscriber.on("message", (_ch: string, message: string) => {
        eventId++;
        stream
          .writeSSE({
            id: String(eventId),
            event: "message",
            data: message,
          })
          .catch(() => {
            // クライアントが切断済みの場合はエラーを無視
          });
      });

      await subscriber.subscribe(channel);

      // Keepalive: 30秒ごとにコメントを送信して接続を維持
      keepalive = setInterval(() => {
        stream
          .writeSSE({
            event: "keepalive",
            data: "",
          })
          .catch(() => {
            // クライアントが切断済みの場合はエラーを無視
          });
      }, KEEPALIVE_INTERVAL_MS);

      // クライアント切断時のクリーンアップ + ストリーム待機
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          if (keepalive !== null) clearInterval(keepalive);
          subscriber?.unsubscribe(channel).catch(() => {});
          subscriber?.quit().catch(() => {});
          activeConnections--;
          resolve();
        });
      });
    } catch (err) {
      if (keepalive !== null) clearInterval(keepalive);
      activeConnections--;
      subscriber?.quit().catch(() => {});
      throw err;
    }
  });
}

export const formsSSERouter = createHonoApp()
  // バリデーション SSE: form:validation:{formId}
  .get("/:id/responses/events", withDualFormAuth("VIEWER"), async (c) => {
    const formId = c.req.param("id");
    const channel = getValidationChannel(formId);
    return createSSEStream(c, channel);
  })
  // エディタ SSE: form:editor:{formId}
  .get("/:id/editor/events", withDualFormAuth("EDITOR"), async (c) => {
    const formId = c.req.param("id");
    const channel = getEditorChannel(formId);
    return createSSEStream(c, channel);
  });
