/**
 * Redis ベースの簡易分散ロック（Worker 用）
 *
 * 同一キーに対する処理を複数プロセス/ジョブ間で直列化する。
 * トークンリフレッシュなど「同時実行で外部 API を二重に叩きたくない」
 * 処理に使用する。
 */

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getPublisherConnectionOptions } from "./redis";

let lockClient: Redis | null = null;

function getLockClient(): Redis {
  if (lockClient) return lockClient;
  lockClient = new Redis(getPublisherConnectionOptions());
  lockClient.on("error", (err) => {
    console.error("[redis-lock] connection error:", err.message);
  });
  return lockClient;
}

/**
 * ロック用 Redis クライアントを閉じる。
 * グレースフルシャットダウン時に呼び、接続リークを防ぐ。
 */
export async function closeLockClient(): Promise<void> {
  if (!lockClient) return;
  try {
    await lockClient.quit();
  } catch (error) {
    console.error(
      "[redis-lock] failed to close lock client:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    lockClient = null;
  }
}

/** 自分が取得したロックのみをアトミックに解放する Lua スクリプト。 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface RedisLockOptions {
  /**
   * ロックの有効期限 (ms)。保持側がクラッシュしても自動解放される。
   * クリティカルセクションの最大実行時間より十分長く設定すること。
   * 短すぎると保持側の処理中に TTL が失効し、別プロセスがロックを
   * 取得して並行実行してしまう。
   */
  ttlMs?: number;
  /**
   * ロック取得を待つ最大時間 (ms)。超過すると例外を投げる。
   * クラッシュした保持側のロックが TTL で解放されるのを待てるよう、
   * `ttlMs` より長く設定すること。
   */
  waitTimeoutMs?: number;
  /** 取得失敗時の再試行間隔 (ms)。 */
  retryDelayMs?: number;
  /** When aborted, lock acquisition retries stop immediately. */
  signal?: AbortSignal;
}

/**
 * Thrown when a Redis lock cannot be acquired before the wait timeout expires.
 *
 * Extends Error and carries the lock key and wait timeout so callers can inspect
 * lock acquisition failures without parsing the message text.
 *
 * @public
 * @param key - Redis lock key that could not be acquired.
 * @param waitTimeoutMs - Wait timeout in milliseconds before acquisition failed.
 */
export class RedisLockAcquireTimeoutError extends Error {
  constructor(
    public readonly key: string,
    public readonly waitTimeoutMs: number,
  ) {
    super(`Failed to acquire redis lock "${key}" within ${waitTimeoutMs}ms`);
    this.name = "RedisLockAcquireTimeoutError";
  }
}

/** Thrown when lock acquisition is interrupted by an AbortSignal. */
export class RedisLockAbortedError extends Error {
  constructor(public readonly key: string) {
    super(`Redis lock acquisition for "${key}" was aborted`);
    this.name = "RedisLockAbortedError";
  }
}

function throwIfAborted(signal: AbortSignal | undefined, key: string): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new RedisLockAbortedError(key);
}

function sleep(ms: number, signal?: AbortSignal, key?: string): Promise<void> {
  throwIfAborted(signal, key ?? "unknown");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new RedisLockAbortedError(key ?? "unknown"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 冪等性キーの現在値を取得する。存在しなければ null を返す。 */
export async function getIdempotencyKeyValue(
  key: string,
): Promise<string | null> {
  return getLockClient().get(key);
}

/** 冪等性キーを value・TTL 付きでセットする。withRedisLock と同一接続を再利用。 */
export async function setIdempotencyKey(
  key: string,
  ttlSeconds: number,
  value = "done",
): Promise<void> {
  await getLockClient().set(key, value, "EX", ttlSeconds);
}

/**
 * `key` のロックを取得してから `fn` を実行し、完了後に解放する。
 *
 * 待機がタイムアウトした場合は例外を投げる（直列化を保証するため
 * ロック無しでの実行は行わない）。呼び出し元のジョブは BullMQ により
 * 再試行される想定。
 */
export async function withRedisLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: RedisLockOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 30_000;
  const waitTimeoutMs = options.waitTimeoutMs ?? 35_000;
  const retryDelayMs = options.retryDelayMs ?? 200;
  const signal = options.signal;

  const redis = getLockClient();
  const lockToken = randomUUID();
  const deadline = Date.now() + waitTimeoutMs;

  let acquired = false;
  while (!acquired) {
    throwIfAborted(signal, key);
    const result = await redis.set(key, lockToken, "PX", ttlMs, "NX");
    if (result === "OK") {
      acquired = true;
      break;
    }
    if (Date.now() + retryDelayMs >= deadline) {
      throw new RedisLockAcquireTimeoutError(key, waitTimeoutMs);
    }
    await sleep(retryDelayMs, signal, key);
  }

  try {
    return await fn();
  } finally {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, lockToken);
    } catch (error) {
      // 解放失敗は致命的ではない（TTL でいずれ自動解放される）。
      console.error(
        `[redis-lock] failed to release lock "${key}":`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
