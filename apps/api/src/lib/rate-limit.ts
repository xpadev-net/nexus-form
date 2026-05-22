import type { Context, MiddlewareHandler, Next } from "hono";
import { getRedisClient } from "./cache/redis-client";
import { extractClientIP } from "./ip-address";
import { logError, logWarn } from "./logger";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context) => string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// インメモリフォールバック用のレート制限ストア
const rateLimitStore = new Map<string, RateLimitEntry>();

export function getClientIp(c: Context): string {
  // `c.env.incoming` is provided by @hono/node-server (Node IncomingMessage).
  // Other adapters (Bun, Deno, Workers) omit it; remoteAddress stays undefined and
  // extractClientIP falls back to "unknown". Add adapter-specific wiring here if needed.
  const maybeEnv = c.env as Record<string, unknown> | undefined;
  const maybeIncoming = maybeEnv?.incoming;
  const remoteAddress =
    typeof maybeIncoming === "object" &&
    maybeIncoming !== null &&
    "socket" in maybeIncoming &&
    typeof maybeIncoming.socket === "object" &&
    maybeIncoming.socket !== null &&
    "remoteAddress" in maybeIncoming.socket &&
    typeof maybeIncoming.socket.remoteAddress === "string"
      ? maybeIncoming.socket.remoteAddress
      : undefined;

  return extractClientIP(
    {
      headers: c.req.raw.headers,
      remoteAddress,
    },
    { strategy: "general" },
  ).ip;
}

function getDefaultKey(c: Context): string {
  return `rate_limit:${getClientIp(c)}`;
}

/**
 * インメモリフォールバック: 古いエントリをクリーンアップ
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [k, v] of rateLimitStore.entries()) {
    if (v.resetTime < now) {
      rateLimitStore.delete(k);
    }
  }
}

/**
 * インメモリフォールバックでレート制限をチェック
 * Redis が利用不可の場合に使用
 */
function checkRateLimitInMemory(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; count: number; resetTime: number } {
  const now = Date.now();

  cleanupExpiredEntries();

  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    const resetTime = now + config.windowMs;
    rateLimitStore.set(key, { count: 1, resetTime });
    return { allowed: true, count: 1, resetTime };
  }

  entry.count++;
  if (entry.count > config.maxRequests) {
    return { allowed: false, count: entry.count, resetTime: entry.resetTime };
  }

  return { allowed: true, count: entry.count, resetTime: entry.resetTime };
}

/**
 * Lua スクリプトによるアトミックな固定ウィンドウレート制限
 *
 * INCR と PEXPIRE を単一のスクリプトで実行し、
 * パイプライン方式で発生し得る競合状態（TTL未設定のキー残存）を防ぐ。
 *
 * 戻り値: [currentCount, ttlMs]
 *   - currentCount: インクリメント後のカウント
 *   - ttlMs: キーの残りTTL（ミリ秒）
 */
const RATE_LIMIT_LUA_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, window_ms)
end

local ttl = redis.call('PTTL', key)
if ttl < 0 then
  redis.call('PEXPIRE', key, window_ms)
  ttl = window_ms
end

return {current, ttl}
`;

/**
 * Redis Lua スクリプトによる固定ウィンドウレート制限チェック
 * 単一の EVAL コマンドでカウント増加とTTL設定をアトミックに実行
 */
async function checkRateLimitRedis(
  key: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; count: number; resetTime: number } | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const result = await redis.eval(
      RATE_LIMIT_LUA_SCRIPT,
      1,
      key,
      config.windowMs.toString(),
    );

    // Lua スクリプトの戻り値はテーブル（配列）: [currentCount, ttlMs]
    if (!Array.isArray(result) || result.length < 2) {
      logWarn("[RateLimit] Unexpected Redis Lua script result", "api", {});
      return null;
    }

    const [rawCount, rawTtl] = result;

    if (typeof rawCount !== "number" || typeof rawTtl !== "number") {
      logWarn("[RateLimit] Unexpected Lua result types", "api", {
        countType: typeof rawCount,
        ttlType: typeof rawTtl,
      });
      return null;
    }

    const currentCount = rawCount;
    const ttlMs = rawTtl > 0 ? rawTtl : config.windowMs;
    const resetTime = Date.now() + ttlMs;

    return {
      allowed: currentCount <= config.maxRequests,
      count: currentCount,
      resetTime,
    };
  } catch (error) {
    logError(
      "[RateLimit] Redis operation failed, falling back to in-memory",
      "api",
      { error },
    );
    return null;
  }
}

/**
 * レート制限ミドルウェアを作成する
 * Redis が利用可能な場合は Redis ベースの固定ウィンドウ方式を使用し、
 * 利用不可の場合はインメモリ Map にフォールバックする
 */
export function createRateLimit(config: RateLimitConfig): MiddlewareHandler {
  return async (c, next) => {
    const key = config.keyGenerator ? config.keyGenerator(c) : getDefaultKey(c);

    // Redis ベースのレート制限を試行
    const redisResult = await checkRateLimitRedis(key, config);

    // Redis が利用不可の場合はインメモリフォールバック
    const result = redisResult ?? checkRateLimitInMemory(key, config);

    // レスポンスヘッダーを設定
    c.header("X-RateLimit-Limit", config.maxRequests.toString());
    c.header(
      "X-RateLimit-Remaining",
      Math.max(0, config.maxRequests - result.count).toString(),
    );
    c.header("X-RateLimit-Reset", result.resetTime.toString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      c.header("Retry-After", Math.max(1, retryAfter).toString());
      return c.json(
        {
          error: {
            message: "Too many requests",
            retryAfter: Math.max(1, retryAfter),
          },
        },
        429,
      );
    }

    return next();
  };
}

// インメモリストアのバックグラウンドクリーンアップ（1分ごと）
const CLEANUP_INTERVAL_MS = 60_000;
const cleanupTimer = setInterval(() => {
  cleanupExpiredEntries();
}, CLEANUP_INTERVAL_MS);
// Node.js プロセスの終了を妨げないように unref
cleanupTimer.unref();

/**
 * セッションチェック用レート制限
 * 1分間に120リクエスト（get-session など自動呼出し対応）
 */
const authSessionRateLimiter = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 120,
  keyGenerator: (c) => `rate_limit:auth_session:${getClientIp(c)}`,
});

/**
 * セキュリティ重要な認証アクション用レート制限
 * 15分間に10リクエスト（sign-in, sign-up, パスワード操作など）
 */
const authActionRateLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyGenerator: (c) => `rate_limit:auth_action:${getClientIp(c)}`,
});

/**
 * 招待コードサインイン用レート制限
 * 15分間に10リクエスト（オンライン総当たり対策）
 */
export const invitationSignInRateLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyGenerator: (c) => `rate_limit:invitation_signin:${getClientIp(c)}`,
});

/**
 * 一般認証エンドポイント用レート制限
 * 1分間に30リクエスト（callback, sign-out など）
 */
const authGeneralRateLimiter = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyGenerator: (c) => `rate_limit:auth_general:${getClientIp(c)}`,
});

/** セキュリティ上重要な認証パス */
const AUTH_SENSITIVE_PREFIXES = [
  "/api/auth/sign-in",
  "/api/auth/sign-up",
  "/api/auth/forget-password",
  "/api/auth/reset-password",
  "/api/auth/change-password",
  "/api/auth/change-email",
];

/**
 * 認証ルート用レート制限ミドルウェア
 * パスに応じて適切なレート制限を自動的に適用する
 */
export const authRouteRateLimiter = async (c: Context, next: Next) => {
  const path = new URL(c.req.url).pathname;

  // セッションチェック — 寛大な制限（自動呼出し対応）
  if (path === "/api/auth/get-session") {
    return authSessionRateLimiter(c, next);
  }

  // セキュリティ重要なアクション — 厳格な制限
  if (
    AUTH_SENSITIVE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
    return authActionRateLimiter(c, next);
  }

  // その他の認証ルート — 中程度の制限
  return authGeneralRateLimiter(c, next);
};

/**
 * 一般APIエンドポイント用レート制限
 * 1分間に60リクエスト
 */
export const generalRateLimiter = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
});
