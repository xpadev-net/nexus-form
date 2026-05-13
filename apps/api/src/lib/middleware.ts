import type { Context, Next } from "hono";
import { auth } from "./auth";

/**
 * セッション認証ミドルウェア
 * Better Auth のセッション情報をコンテキストに設定する
 */
export const authMiddleware = async (c: Context, next: Next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }

  c.set("user", session.user);
  c.set("session", session.session);
  return next();
};

/**
 * 認証必須ミドルウェア
 * ユーザーが認証されていない場合は 401 を返す
 * アカウントが停止されている場合は 403 を返す
 */
export const requireAuth = async (c: Context, next: Next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (user.isSuspended) {
    return c.json({ error: "アカウントが停止されています" }, 403);
  }

  return next();
};

/**
 * 管理者権限必須ミドルウェア
 */
export const requireAdmin = async (c: Context, next: Next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (user.isSuspended) {
    return c.json({ error: "アカウントが停止されています" }, 403);
  }

  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  return next();
};
