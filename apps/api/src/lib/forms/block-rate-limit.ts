import type { Context } from "hono";
import { createRateLimit } from "../rate-limit";

/**
 * HonoリクエストコンテキストからクライアントIPを抽出
 */
function extractClientIP(c: Context): string {
  const cfIp = c.req.header("cf-connecting-ip");
  const forwarded = c.req.header("x-forwarded-for");
  return cfIp || forwarded?.split(",")[0]?.trim() || "unknown";
}

/**
 * ブロック更新用のレート制限
 * 1分間に300リクエストまで
 */
export const blockUpdateRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1分
  maxRequests: 300,
  keyGenerator: (c: Context) => {
    // URLからformIdを抽出
    const url = new URL(c.req.url);
    const pathSegments = url.pathname.split("/");
    const formIdIndex = pathSegments.indexOf("forms") + 1;
    const formId = pathSegments[formIdIndex] || "unknown";

    // IPアドレスベースのキー生成
    const ip = extractClientIP(c);

    return `block_update:${formId}:${ip}`;
  },
});

/**
 * 変更検知用のレート制限
 * 1分間に120リクエストまで（2秒ポーリングを想定）
 */
export const changesRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1分
  maxRequests: 120,
  keyGenerator: (c: Context) => {
    // URLからformIdを抽出
    const url = new URL(c.req.url);
    const pathSegments = url.pathname.split("/");
    const formIdIndex = pathSegments.indexOf("forms") + 1;
    const formId = pathSegments[formIdIndex] || "unknown";

    // IPアドレスベースのキー生成
    const ip = extractClientIP(c);

    return `changes:${formId}:${ip}`;
  },
});

/**
 * セッション更新（heartbeat）用のレート制限
 * 1分間に60リクエストまで
 */
export const sessionRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1分
  maxRequests: 60,
  keyGenerator: (c: Context) => {
    // URLからformIdとblockIdを抽出
    const url = new URL(c.req.url);
    const pathSegments = url.pathname.split("/");
    const formIdIndex = pathSegments.indexOf("forms") + 1;
    const blockIdIndex = pathSegments.indexOf("blocks") + 1;
    const formId = pathSegments[formIdIndex] || "unknown";
    const blockId = pathSegments[blockIdIndex] || "unknown";

    // IPアドレスベースのキー生成
    const ip = extractClientIP(c);

    return `session:${formId}:${blockId}:${ip}`;
  },
});
