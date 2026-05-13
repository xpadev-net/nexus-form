/**
 * OAuth トークンストア（Drizzle ORM版）
 *
 * googleOAuthToken テーブルからトークンを取得・復号し、
 * 必要に応じてリフレッシュする
 */

import { db, googleOAuthToken } from "@nexus-form/database";
import { eq } from "drizzle-orm";
import { decryptFromBase64, encryptToBase64 } from "./field-encryption";

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
 * トークンが期限切れの場合にリフレッシュする
 */
export async function refreshTokenIfNeeded(
  token: OAuthToken,
): Promise<OAuthToken> {
  const skewMs = 60_000; // 1分の安全マージン
  const now = Date.now();
  const expiryMs = Date.parse(token.expiryDate);

  if (Number.isNaN(expiryMs) || expiryMs - skewMs > now) {
    return token;
  }

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
