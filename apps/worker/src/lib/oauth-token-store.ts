/**
 * OAuth トークンストア（Drizzle ORM版）
 *
 * googleOAuthToken テーブルからトークンを取得・復号し、
 * 必要に応じてリフレッシュする
 */

import { db, googleOAuthToken } from "@nexus-form/database";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MAX_TIMER_MS, parsePositiveIntEnv } from "./env";
import { decryptFromBase64, encryptToBase64 } from "./field-encryption";
import { withRedisLock } from "./redis-lock";
import { workerShutdownSignal } from "./shutdown-signal";

/** トークンリフレッシュ用 fetch のタイムアウト (ms)。 */
const REFRESH_TIMEOUT_MS = parsePositiveIntEnv(
  "GOOGLE_OAUTH_REFRESH_TIMEOUT_MS",
  10_000,
  MAX_TIMER_MS,
);

/** 期限切れ判定の安全マージン (ms)。 */
const EXPIRY_SKEW_MS = 60_000;

const OAuthScopesSchema = z.array(z.string());

const GoogleTokenRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const GoogleTokenRefreshErrorResponseSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
});

type OAuthRefreshPermanentAuthReason =
  | "bad_request"
  | "invalid_grant"
  | "unauthorized";

export class OAuthRefreshPermanentAuthError extends Error {
  readonly errorCode: string | undefined;
  readonly reason: OAuthRefreshPermanentAuthReason;
  readonly status: number | undefined;

  constructor(params: {
    errorCode?: string;
    reason: OAuthRefreshPermanentAuthReason;
    status?: number;
  }) {
    const details = params.errorCode
      ? `${params.errorCode}${params.status ? `, HTTP ${params.status}` : ""}`
      : params.status
        ? `HTTP ${params.status}`
        : params.reason;
    super(`Google OAuth refresh requires reauthorization (${details})`);
    this.name = "OAuthRefreshPermanentAuthError";
    this.errorCode = params.errorCode;
    this.reason = params.reason;
    this.status = params.status;
  }
}

export function isOAuthRefreshPermanentAuthError(
  error: unknown,
): error is OAuthRefreshPermanentAuthError {
  return error instanceof OAuthRefreshPermanentAuthError;
}

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
  const scopesResult = OAuthScopesSchema.safeParse(row.scopes);

  return {
    userId,
    accessToken,
    refreshToken,
    expiryDate: row.expiryDate.toISOString(),
    scopes: scopesResult.success ? scopesResult.data : [],
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
 * expiryDate が解釈不能な場合は安全側に倒して期限切れ扱いにする。
 */
function isTokenExpired(token: OAuthToken): boolean {
  const expiryMs = Date.parse(token.expiryDate);
  if (Number.isNaN(expiryMs)) return true;
  return expiryMs - EXPIRY_SKEW_MS <= Date.now();
}

async function readTokenRefreshResponseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (error) {
    if (res.ok) {
      throw error;
    }
    return undefined;
  }
}

function classifyPermanentAuthFailure(params: {
  body: unknown;
  status: number;
}): OAuthRefreshPermanentAuthError | null {
  const parsedError = GoogleTokenRefreshErrorResponseSchema.safeParse(
    params.body,
  );
  const errorCode = parsedError.success ? parsedError.data.error : undefined;
  const isClientError = params.status >= 400 && params.status < 500;

  if (!isClientError) {
    return null;
  }

  if (errorCode === "invalid_grant") {
    return new OAuthRefreshPermanentAuthError({
      errorCode,
      reason: "invalid_grant",
      status: params.status,
    });
  }

  if (params.status === 400) {
    return new OAuthRefreshPermanentAuthError({
      reason: "bad_request",
      status: params.status,
      ...(errorCode ? { errorCode } : {}),
    });
  }

  if (params.status === 401) {
    return new OAuthRefreshPermanentAuthError({
      reason: "unauthorized",
      status: params.status,
      ...(errorCode ? { errorCode } : {}),
    });
  }

  return null;
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

  const responseBody = await readTokenRefreshResponseJson(res);

  if (!res.ok) {
    const authFailure = classifyPermanentAuthFailure({
      body: responseBody,
      status: res.status,
    });
    if (authFailure) {
      throw authFailure;
    }
    throw new Error(`Google token refresh failed: ${res.status}`);
  }

  const json = GoogleTokenRefreshResponseSchema.parse(responseBody);

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

  return withRedisLock(
    `oauth-refresh:${token.userId}`,
    async () => {
      // ロック取得を待つ間に別プロセスがリフレッシュ済みの可能性があるため、
      // 最新のトークンを再取得してから判定する。
      const latest = await getOAuthToken(token.userId);
      // 待機中にレコードが削除された場合（連携解除など）は、古い token で
      // リフレッシュして削除済みレコードを復活させないよう明示的に失敗させる。
      if (!latest) {
        throw new Error(
          `OAuth token for user ${token.userId} was removed during refresh`,
        );
      }
      if (!isTokenExpired(latest)) {
        return latest;
      }
      return performTokenRefresh(latest);
    },
    {
      // クリティカルセクションは fetch(REFRESH_TIMEOUT_MS) + DB 読み書き。
      // TTL はその最大時間より十分長く、wait はさらに長くして
      // クラッシュした保持側のロック失効を待てるようにする。
      ttlMs: REFRESH_TIMEOUT_MS + 20_000,
      waitTimeoutMs: REFRESH_TIMEOUT_MS + 25_000,
      signal: workerShutdownSignal,
    },
  );
}
