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

interface SseMessageClient {
  sendMessage: (id: string, data: string) => Promise<void>;
  close: () => void;
}

interface RedisSubscriber {
  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): RedisSubscriber;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

interface ChannelSubscription {
  subscriber: RedisSubscriber;
  clients: Map<symbol, { eventId: number; client: SseMessageClient }>;
  subscribePromise: Promise<unknown>;
  closingPromise: Promise<void> | null;
}

interface SseChannelRegistry {
  attach: (
    channel: string,
    client: SseMessageClient,
  ) => Promise<() => Promise<void>>;
  closeAll: () => Promise<void>;
}

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

export function createSseChannelRegistry(
  subscriberFactory: () => RedisSubscriber = createSubscriber,
): SseChannelRegistry {
  const subscriptions = new Map<string, ChannelSubscription>();
  let acceptingClients = true;

  async function closeSubscription(
    channel: string,
    subscription: ChannelSubscription,
  ): Promise<void> {
    if (subscription.closingPromise) {
      await subscription.closingPromise;
      return;
    }

    subscription.closingPromise = (async () => {
      subscriptions.delete(channel);
      const clients = Array.from(subscription.clients.values());
      subscription.clients.clear();
      for (const entry of clients) {
        entry.client.close();
      }
      await subscription.subscriber.unsubscribe(channel).catch(() => {});
      await subscription.subscriber.quit().catch(() => {});
    })();
    await subscription.closingPromise;
  }

  function getSubscription(channel: string): ChannelSubscription {
    const existing = subscriptions.get(channel);
    if (existing) return existing;

    const subscriber = subscriberFactory();
    const subscription: ChannelSubscription = {
      subscriber,
      clients: new Map(),
      subscribePromise: subscriber.subscribe(channel),
      closingPromise: null,
    };

    subscriber.on("message", (receivedChannel: string, message: string) => {
      if (receivedChannel !== channel) return;

      for (const entry of subscription.clients.values()) {
        entry.eventId++;
        entry.client.sendMessage(String(entry.eventId), message).catch(() => {
          // クライアントが切断済みの場合はエラーを無視
        });
      }
    });

    subscriptions.set(channel, subscription);
    return subscription;
  }

  return {
    async attach(
      channel: string,
      client: SseMessageClient,
    ): Promise<() => Promise<void>> {
      if (!acceptingClients) {
        client.close();
        return async () => undefined;
      }

      const subscription = getSubscription(channel);
      const clientId = Symbol(channel);
      subscription.clients.set(clientId, { eventId: 0, client });

      try {
        await subscription.subscribePromise;
      } catch (error) {
        subscription.clients.delete(clientId);
        if (subscription.clients.size === 0) {
          await closeSubscription(channel, subscription);
        }
        throw error;
      }

      let detached = false;
      return async () => {
        if (detached) return;
        detached = true;

        subscription.clients.delete(clientId);
        if (subscription.clients.size === 0) {
          await closeSubscription(channel, subscription);
        }
      };
    },
    async closeAll(): Promise<void> {
      acceptingClients = false;
      await Promise.all(
        Array.from(subscriptions.entries()).map(([channel, subscription]) =>
          closeSubscription(channel, subscription),
        ),
      );
    },
  };
}

const sseChannelRegistry = createSseChannelRegistry();

export async function closeSseSubscribers(): Promise<void> {
  await sseChannelRegistry.closeAll();
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
    let detachClient: (() => Promise<void>) | null = null;
    let cleanupPromise: Promise<void> | null = null;
    let closeRequested = false;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let resolveStream: (() => void) | null = null;
    const cleanupClient = (): Promise<void> => {
      if (cleanupPromise) return cleanupPromise;
      if (detachClient === null) return Promise.resolve();
      cleanupPromise = detachClient();
      return cleanupPromise;
    };
    const closeStream = (): void => {
      closeRequested = true;
      cleanupClient().catch(() => {});
      resolveStream?.();
    };

    try {
      const streamClosed = new Promise<void>((resolve) => {
        resolveStream = resolve;
        stream.onAbort(closeStream);
      });
      detachClient = await sseChannelRegistry.attach(channel, {
        sendMessage: (id, data) =>
          stream.writeSSE({
            id,
            event: "message",
            data,
          }),
        close: closeStream,
      });
      if (closeRequested) return;

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
      await streamClosed;
    } finally {
      resolveStream = null;
      if (keepalive !== null) clearInterval(keepalive);
      activeConnections--;
      await cleanupClient();
    }
  });
}

export const formsSSERouter = createHonoApp()
  // バリデーション SSE: form:validation:{formId}
  .get("/:id/responses/events", withDualFormAuth("EDITOR"), async (c) => {
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
