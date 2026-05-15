/**
 * OAuth トークンストア（Drizzle ORM版）
 *
 * googleOAuthToken テーブルからトークンを取得・復号し、
 * 必要に応じてリフレッシュする
 */

import { db, googleOAuthToken } from "@nexus-form/database";
import { eq } from "drizzle-orm";
import { decryptFromBase64, encryptToBase64 } from "./field-encryption";
import { withRedisLock } from "./redis-lock";

/** トークンリフレッシュ用 fetch のタイムアウト (ms)。 */
const REFRESH_TIMEOUT_MS =
  Number(process.env.GOOGLE_OAUTH_REFRESH_TIMEOUT_MS) || 10_000;

/** 期限切れ判定の安全マージン (ms)。 */
const EXPIRY_SKEW_MS = 60_000;

export interface OAuthToken {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: string;
  scopes: string[];
}

/**
 * ユーザーIDからOAuthトークンを取得する
 */
export async function getOAuthToken(
  userId: string,
): Promise<OAuthToken | null> {
  const [row] = await db
    .select()
    .from(googleOAuthToken)
    .where(eq(googleOAuthToken.userId, userId))
    .limit(1);

  if (!row) return null;

  const accessToken = decryptFromBase64(row.accessTokenEnc);
  const refreshToken = decryptFromBase64(row.refreshTokenEnc);

  return {
    userId,
    accessToken,
    refreshToken,
    expiryDate: row.expiryDate.toISOString(),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
  };
}

/**
 * OAuthトークンを保存する
 */
export async function saveOAuthToken(
  userId: string,
  token: OAuthToken,
): Promise<void> {
  const accessTokenEnc = encryptToBase64(token.accessToken);
  const refreshTokenEnc = encryptToBase64(token.refreshToken);
  const expiryDate = new Date(token.expiryDate);
  const scopes = token.scopes ?? [];

  const [existing] = await db
    .select({ id: googleOAuthToken.id })
    .from(googleOAuthToken)
    .where(eq(googleOAuthToken.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(googleOAuthToken)
      .set({ accessTokenEnc, refreshTokenEnc, expiryDate, scopes })
      .where(eq(googleOAuthToken.userId, userId));
  } else {
    const { randomUUID } = await import("node:crypto");
    await db.insert(googleOAuthToken).values({
      id: randomUUID(),
      userId,
      accessTokenEnc,
      refreshTokenEnc,
      expiryDate,
      scopes,
    });
  }
}

/**
 * トークンが期限切れ（安全マージン込み）かどうかを判定する。
 * expiryDate が解釈不能な場合はリフレッシュ対象外とみなす。
 */
function isTokenExpired(token: OAuthToken): boolean {
  const expiryMs = Date.parse(token.expiryDate);
  if (Number.isNaN(expiryMs)) return false;
  return expiryMs - EXPIRY_SKEW_MS <= Date.now();
}

/**
 * 実際にトークンリフレッシュ API を呼び、結果を保存して返す。
 */
async function performTokenRefresh(token: OAuthToken): Promise<OAuthToken> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    // 接続〜レスポンスボディ受信までを含めてタイムアウトさせ、
    // Google 無応答時にワーカーが無期限ブロックするのを防ぐ。
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  };

  const newExpiry = new Date(Date.now() + json.expires_in * 1000).toISOString();
  const scopes = json.scope ? json.scope.split(" ") : token.scopes;

  const updated: OAuthToken = {
    ...token,
    accessToken: json.access_token,
    expiryDate: newExpiry,
    scopes,
  };

  await saveOAuthToken(token.userId, updated);
  return updated;
}

/**
 * トークンが期限切れの場合にリフレッシュする。
 *
 * 同一ユーザーのリフレッシュは Redis ロックで直列化し、複数ジョブが
 * 同時に Google のトークンエンドポイントを叩くのを防ぐ。
 */
export async function refreshTokenIfNeeded(
  token: OAuthToken,
): Promise<OAuthToken> {
  if (!isTokenExpired(token)) {
    return token;
  }

  return withRedisLock(`oauth-refresh:${token.userId}`, async () => {
    // ロック取得を待つ間に別プロセスがリフレッシュ済みの可能性があるため、
    // 最新のトークンを再取得してから判定する。
    const latest = await getOAuthToken(token.userId);
    if (latest && !isTokenExpired(latest)) {
      return latest;
    }
    return performTokenRefresh(latest ?? token);
  });
}
