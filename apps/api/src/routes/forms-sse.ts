/**
 * SSE (Server-Sent Events) エンドポイント
 *
 * Redis Pub/Sub をバックエンドとして、フォーム関連のリアルタイムイベントを配信する
 * - GET /:id/responses/events — バリデーション結果の更新 (form:validation:{formId})
 * - GET /:id/editor/events — ブロック・セッション変更 (form:editor:{formId})
 */

import {
  EDITOR_CHANNEL_PREFIX,
  getEditorChannel,
  getValidationChannel,
  parseSseAccessRevokedEvent,
  type SseAccessRevokedEvent,
  VALIDATION_CHANNEL_PREFIX,
} from "@nexus-form/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import Redis from "ioredis";
import { checkFormPermissionLevel, withDualFormAuth } from "../lib/dual-auth";
import { createHonoApp, type Env } from "../lib/hono";
import { logError, logWarn } from "../lib/logger";
import { getRedisConnection } from "../lib/redis";
import { captureError } from "../lib/sentry";

const KEEPALIVE_INTERVAL_MS = 30_000;

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    String(parsed) !== raw.trim()
  ) {
    logWarn(
      `SSE config: ${name}="${raw}" is not a positive integer; falling back to ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

/**
 * SSE 同時接続数のプロセスローカル上限。
 *
 * これは各 API プロセスの Redis subscriber / stream リソース保護を目的とする。
 * マルチレプリカ環境のクラスタ全体上限はロードバランサーや外部 rate limit で管理し、
 * ここでは 1 ユーザー・1 フォームがプロセス内の全枠を占有しないようにする。
 */
const MAX_SSE_CONNECTIONS = parseIntEnv("SSE_MAX_CONNECTIONS", 200);
const MAX_SSE_CONNECTIONS_PER_USER = parseIntEnv(
  "SSE_MAX_CONNECTIONS_PER_USER",
  20,
);
const MAX_SSE_CONNECTIONS_PER_FORM = parseIntEnv(
  "SSE_MAX_CONNECTIONS_PER_FORM",
  50,
);
const MAX_SSE_PENDING_MESSAGES_PER_CLIENT = parseIntEnv(
  "SSE_MAX_PENDING_MESSAGES_PER_CLIENT",
  100,
);

interface SseConnectionScope {
  userId: string;
  formId: string;
}

interface SseConnectionRejection {
  status: 503;
  message: string;
}

interface SseConnectionPermit {
  release: () => void;
}

interface SseConnectionLimiter {
  tryAcquire: (
    scope: SseConnectionScope,
  ) => SseConnectionPermit | SseConnectionRejection;
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrementCount(counts: Map<string, number>, key: string): void {
  const nextCount = (counts.get(key) ?? 0) - 1;
  if (nextCount <= 0) {
    counts.delete(key);
    return;
  }
  counts.set(key, nextCount);
}

export function createSseConnectionLimiter(options: {
  maxTotal: number;
  maxPerUser: number;
  maxPerForm: number;
}): SseConnectionLimiter {
  const userConnections = new Map<string, number>();
  const formConnections = new Map<string, number>();
  let totalConnections = 0;

  return {
    tryAcquire(scope: SseConnectionScope) {
      if (totalConnections >= options.maxTotal) {
        return {
          status: 503,
          message: "Too many SSE connections",
        };
      }

      if ((userConnections.get(scope.userId) ?? 0) >= options.maxPerUser) {
        return {
          status: 503,
          message: "Too many SSE connections for this user",
        };
      }

      if ((formConnections.get(scope.formId) ?? 0) >= options.maxPerForm) {
        return {
          status: 503,
          message: "Too many SSE connections for this form",
        };
      }

      totalConnections++;
      incrementCount(userConnections, scope.userId);
      incrementCount(formConnections, scope.formId);

      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          totalConnections--;
          decrementCount(userConnections, scope.userId);
          decrementCount(formConnections, scope.formId);
        },
      };
    },
  };
}

const sseConnectionLimiter = createSseConnectionLimiter({
  maxTotal: MAX_SSE_CONNECTIONS,
  maxPerUser: MAX_SSE_CONNECTIONS_PER_USER,
  maxPerForm: MAX_SSE_CONNECTIONS_PER_FORM,
});

interface SseMessageClient {
  sendMessage: (id: string, data: string) => Promise<void>;
  close: () => void;
}

type RedisMessageListener = (channel: string, message: string) => void;
type RedisErrorListener = (error: unknown) => void;
type RedisSubscriberEvent = "message" | "error";
type RedisSubscriberEventListener = RedisMessageListener | RedisErrorListener;

interface RedisSubscriber {
  on(event: "message", listener: RedisMessageListener): RedisSubscriber;
  on(event: "error", listener: RedisErrorListener): RedisSubscriber;
  off?(
    event: RedisSubscriberEvent,
    listener: RedisSubscriberEventListener,
  ): RedisSubscriber;
  removeListener?(
    event: RedisSubscriberEvent,
    listener: RedisSubscriberEventListener,
  ): RedisSubscriber;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

interface SseClientEntry {
  eventId: number;
  client: SseMessageClient;
  sendChain: Promise<void>;
  pendingMessages: number;
  closed: boolean;
  activated: boolean;
  userId?: string;
  shareLinkId?: string;
}

interface ChannelSubscription {
  subscriber: RedisSubscriber;
  clients: Map<symbol, SseClientEntry>;
  subscribePromise: Promise<unknown>;
  closingPromise: Promise<void> | null;
  messageListener: RedisMessageListener;
  errorListener: RedisErrorListener;
}

interface SseChannelRegistry {
  ensureSubscribed: (channel: string) => Promise<void>;
  attach: (
    channel: string,
    client: SseMessageClient,
    options?: {
      preflighted?: boolean;
      userId?: string;
      shareLinkId?: string;
      activation?: Promise<void>;
    },
  ) => Promise<() => Promise<void>>;
  closeAccessRevoked: (event: SseAccessRevokedEvent) => Promise<number>;
  closeAll: () => Promise<void>;
}

interface FormsSSERouterOptions {
  channelRegistry?: SseChannelRegistry;
  connectionLimiter?: SseConnectionLimiter;
}

type FormsSSERouter = ReturnType<typeof createHonoApp>;

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

  function removeRedisSubscriberListener(
    subscriber: RedisSubscriber,
    event: RedisSubscriberEvent,
    listener: RedisSubscriberEventListener,
  ): void {
    if (subscriber.off) {
      subscriber.off(event, listener);
      return;
    }
    subscriber.removeListener?.(event, listener);
  }

  function closeClientSafely(channel: string, entry: SseClientEntry): void {
    try {
      entry.client.close();
    } catch (error) {
      logWarn("SSE client close failed during subscription cleanup", "api", {
        channel,
        error,
      });
    }
  }

  async function closeSubscription(
    channel: string,
    subscription: ChannelSubscription,
  ): Promise<void> {
    if (subscription.closingPromise) {
      await subscription.closingPromise;
      return;
    }

    subscription.closingPromise = Promise.resolve().then(async () => {
      subscriptions.delete(channel);
      const clients = Array.from(subscription.clients.values());
      subscription.clients.clear();
      for (const entry of clients) {
        entry.closed = true;
        closeClientSafely(channel, entry);
      }
      try {
        await subscription.subscriber.unsubscribe(channel).catch(() => {});
        await subscription.subscriber.quit().catch(() => {});
      } finally {
        removeRedisSubscriberListener(
          subscription.subscriber,
          "message",
          subscription.messageListener,
        );
        removeRedisSubscriberListener(
          subscription.subscriber,
          "error",
          subscription.errorListener,
        );
      }
    });
    await subscription.closingPromise;
  }

  function handleSubscriberError(
    channel: string,
    subscription: ChannelSubscription,
    error: unknown,
  ): void {
    if (subscription.closingPromise) return;

    // Redis subscriber errors invalidate this shared stream source. Close the
    // current SSE clients so browser EventSource clients retry against a fresh
    // subscription on reconnect.
    logError(
      "SSE Redis subscriber error; closing clients and relying on EventSource retry",
      "api",
      { channel, error },
    );
    captureError(error);
    void closeSubscription(channel, subscription);
  }

  function shouldCloseForRevokeEvent(
    entry: SseClientEntry,
    event: SseAccessRevokedEvent,
  ): boolean {
    if (event.targetType === "form") return true;
    if (event.targetType === "user") return entry.userId === event.userId;
    return entry.shareLinkId === event.shareLinkId;
  }

  function getFormIdForSseChannel(channel: string): string | null {
    if (channel.startsWith(VALIDATION_CHANNEL_PREFIX)) {
      return channel.slice(VALIDATION_CHANNEL_PREFIX.length);
    }
    if (channel.startsWith(EDITOR_CHANNEL_PREFIX)) {
      return channel.slice(EDITOR_CHANNEL_PREFIX.length);
    }
    return null;
  }

  function closeClientEntry(
    channel: string,
    subscription: ChannelSubscription,
    clientId: symbol,
    entry: SseClientEntry,
  ): void {
    if (entry.closed) return;
    entry.closed = true;
    subscription.clients.delete(clientId);
    closeClientSafely(channel, entry);
    // Safety net for races where the stream detach path already ran while
    // sibling clients still existed; this may be the last remaining client.
    if (subscription.clients.size === 0) {
      void closeSubscription(channel, subscription);
    }
  }

  function closeRevokedClientEntries(
    channel: string,
    subscription: ChannelSubscription,
    event: SseAccessRevokedEvent,
  ): number {
    let closedCount = 0;
    for (const [clientId, entry] of subscription.clients.entries()) {
      if (entry.closed) continue;
      if (!shouldCloseForRevokeEvent(entry, event)) continue;
      closeClientEntry(channel, subscription, clientId, entry);
      closedCount++;
    }
    return closedCount;
  }

  function getSubscription(channel: string): ChannelSubscription {
    const existing = subscriptions.get(channel);
    if (existing) return existing;

    const subscriber = subscriberFactory();
    const subscription: ChannelSubscription = {
      subscriber,
      clients: new Map(),
      subscribePromise: Promise.resolve(),
      closingPromise: null,
      messageListener: () => undefined,
      errorListener: () => undefined,
    };

    subscription.messageListener = (
      receivedChannel: string,
      message: string,
    ) => {
      if (receivedChannel !== channel) return;

      const revokeEvent = parseSseAccessRevokedEvent(message);
      if (revokeEvent) {
        if (getFormIdForSseChannel(channel) === revokeEvent.formId) {
          closeRevokedClientEntries(channel, subscription, revokeEvent);
        }
        return;
      }

      for (const [clientId, entry] of subscription.clients.entries()) {
        if (entry.closed) continue;
        if (!entry.activated) continue;

        if (entry.pendingMessages >= MAX_SSE_PENDING_MESSAGES_PER_CLIENT) {
          closeClientEntry(channel, subscription, clientId, entry);
          continue;
        }

        entry.eventId++;
        const eventId = String(entry.eventId);
        entry.pendingMessages++;
        entry.sendChain = entry.sendChain
          .then(async () => {
            try {
              if (entry.closed) return;
              await entry.client.sendMessage(eventId, message);
            } finally {
              entry.pendingMessages--;
            }
          })
          .catch(() => {
            closeClientEntry(channel, subscription, clientId, entry);
          });
      }
    };
    subscription.errorListener = (error: unknown) => {
      handleSubscriberError(channel, subscription, error);
    };

    subscriber.on("error", subscription.errorListener);
    subscriber.on("message", subscription.messageListener);
    subscriptions.set(channel, subscription);
    subscription.subscribePromise = subscriber.subscribe(channel);
    return subscription;
  }

  async function ensureSubscribed(channel: string): Promise<void> {
    if (!acceptingClients) {
      throw new Error("SSE subscribers are shutting down");
    }

    const subscription = getSubscription(channel);
    try {
      await subscription.subscribePromise;
      if (
        subscriptions.get(channel) !== subscription ||
        subscription.closingPromise
      ) {
        throw new Error("SSE subscription closed before becoming ready");
      }
    } catch (error) {
      if (subscription.clients.size === 0) {
        await closeSubscription(channel, subscription);
      }
      throw error;
    }
  }

  return {
    ensureSubscribed,
    async attach(
      channel: string,
      client: SseMessageClient,
      options: {
        preflighted?: boolean;
        userId?: string;
        shareLinkId?: string;
        activation?: Promise<void>;
      } = {},
    ): Promise<() => Promise<void>> {
      if (!acceptingClients) {
        client.close();
        return async () => undefined;
      }

      const subscription = getSubscription(channel);
      const clientId = Symbol(channel);
      const entry: SseClientEntry = {
        eventId: 0,
        client,
        sendChain: Promise.resolve(),
        pendingMessages: 0,
        closed: false,
        activated: options.activation === undefined,
        userId: options.userId,
        shareLinkId: options.shareLinkId,
      };
      subscription.clients.set(clientId, entry);
      options.activation
        ?.then(() => {
          if (!entry.closed) entry.activated = true;
        })
        .catch(() => {
          closeClientEntry(channel, subscription, clientId, entry);
        });

      try {
        if (!options.preflighted) {
          await subscription.subscribePromise;
        }
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

        entry.closed = true;
        subscription.clients.delete(clientId);
        if (subscription.clients.size === 0) {
          await closeSubscription(channel, subscription);
        }
      };
    },
    async closeAccessRevoked(event: SseAccessRevokedEvent): Promise<number> {
      const channels = [
        getEditorChannel(event.formId),
        getValidationChannel(event.formId),
      ];
      let closedCount = 0;
      for (const channel of channels) {
        const subscription = subscriptions.get(channel);
        if (!subscription) continue;
        closedCount += closeRevokedClientEntries(channel, subscription, event);
      }
      return closedCount;
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

export async function closeLocalSseConnectionsForAccessRevoked(
  event: SseAccessRevokedEvent,
): Promise<number> {
  return await sseChannelRegistry.closeAccessRevoked(event);
}

export async function closeSseSubscribers(): Promise<void> {
  await sseChannelRegistry.closeAll();
}

function createActivationGate(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/**
 * SSE ストリームを作成する共通ヘルパー
 */
async function createSSEStream(
  c: Context<Env>,
  channel: string,
  formId: string,
  options: {
    channelRegistry: SseChannelRegistry;
    connectionLimiter: SseConnectionLimiter;
  },
) {
  const auth = c.get("dualAuthContext");
  if (!auth) return c.text("SSE auth context unavailable", 500);

  const permit = options.connectionLimiter.tryAcquire({
    userId: auth.user_id,
    formId,
  });
  if ("status" in permit) return c.text(permit.message, permit.status);

  // プリフライト中の client abort 検出のため、ensureSubscribed より前に
  // リクエストの AbortSignal にリスナーを登録する。
  // これがないと、ensureSubscribed の I/O 待機中に client が切断した場合、
  // stream.onAbort が未登録のまま abort を見逃し permit/subscriber がリークする。
  const reqSignal: AbortSignal | undefined = c.req.raw.signal;
  let preflightAborted = false;
  const onReqAbort = (): void => {
    preflightAborted = true;
  };
  if (reqSignal?.aborted) {
    preflightAborted = true;
  } else {
    reqSignal?.addEventListener("abort", onReqAbort, { once: true });
  }

  try {
    await options.channelRegistry.ensureSubscribed(channel);

    if (preflightAborted) {
      permit.release();
      return c.text("Connection lost before subscription ready", 503);
    }

    return streamSSE(c, async (stream) => {
      let detachClient: (() => Promise<void>) | null = null;
      let cleanupPromise: Promise<void> | null = null;
      let closeRequested = false;
      let permitReleased = false;
      let keepalive: ReturnType<typeof setInterval> | null = null;
      let resolveStream: (() => void) | null = null;
      const releasePermit = (): void => {
        if (permitReleased) return;
        permitReleased = true;
        permit.release();
      };
      const finalizeStream = (): Promise<void> => {
        if (cleanupPromise) return cleanupPromise;
        if (detachClient === null) {
          releasePermit();
          return Promise.resolve();
        }
        cleanupPromise = detachClient().finally(() => {
          releasePermit();
        });
        return cleanupPromise;
      };
      const closeStream = (): void => {
        if (closeRequested) return;
        closeRequested = true;
        if (keepalive !== null) {
          clearInterval(keepalive);
          keepalive = null;
        }
        try {
          stream.abort();
        } catch {
          // noop
        }
        void stream.close();
        void finalizeStream()
          .catch(() => {})
          .finally(() => {
            resolveStream?.();
          });
      };

      try {
        const streamClosed = new Promise<void>((resolve) => {
          resolveStream = resolve;
          stream.onAbort(closeStream);
        });
        const activation = createActivationGate();
        detachClient = await options.channelRegistry.attach(
          channel,
          {
            sendMessage: (id, data) =>
              stream.writeSSE({
                id,
                event: "message",
                data,
              }),
            close: closeStream,
          },
          {
            preflighted: true,
            userId: auth.user_id,
            shareLinkId: auth.share_link_id,
            activation: activation.promise,
          },
        );
        try {
          await checkFormPermissionLevel(auth, formId, "EDITOR");
          activation.resolve();
        } catch (error) {
          // Rejecting the activation gate closes the registry entry; this
          // synchronous close also tears down the HTTP stream immediately.
          activation.reject(error);
          closeStream();
          return;
        }
        if (closeRequested) return;

        // Keepalive: 30秒ごとにコメントを送信して接続を維持
        keepalive = setInterval(() => {
          stream
            .writeSSE({
              event: "keepalive",
              data: "",
            })
            .catch((error: unknown) => {
              logWarn(`SSE keepalive failed; closing stream: ${error}`);
              closeStream();
            });
        }, KEEPALIVE_INTERVAL_MS);

        // クライアント切断時のクリーンアップ + ストリーム待機
        await streamClosed;
      } finally {
        resolveStream = null;
        if (keepalive !== null) clearInterval(keepalive);
        await finalizeStream();
      }
    });
  } catch (error) {
    console.error("SSE subscription preflight failed", error);
    permit.release();
    return c.text("SSE subscription unavailable", 503);
  }
}

/**
 * Creates the form SSE router.
 *
 * @param options Optional registry/limiter overrides for tests and controlled wiring.
 * @returns A typed Hono router serving validation and editor SSE endpoints.
 */
export function createFormsSSERouter(
  options: FormsSSERouterOptions = {},
): FormsSSERouter {
  const channelRegistry = options.channelRegistry ?? sseChannelRegistry;
  const connectionLimiter = options.connectionLimiter ?? sseConnectionLimiter;

  return (
    createHonoApp()
      // バリデーション SSE: form:validation:{formId}
      .get("/:id/responses/events", withDualFormAuth("EDITOR"), async (c) => {
        const formId = c.req.param("id");
        const channel = getValidationChannel(formId);
        return createSSEStream(c, channel, formId, {
          channelRegistry,
          connectionLimiter,
        });
      })
      // エディタ SSE: form:editor:{formId}
      .get("/:id/editor/events", withDualFormAuth("EDITOR"), async (c) => {
        const formId = c.req.param("id");
        const channel = getEditorChannel(formId);
        return createSSEStream(c, channel, formId, {
          channelRegistry,
          connectionLimiter,
        });
      })
  );
}

export const formsSSERouter: FormsSSERouter = createFormsSSERouter();
