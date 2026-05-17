import { randomBytes } from "node:crypto";
import { db } from "@nexus-form/database";
import { apiToken } from "@nexus-form/database/schema";
import {
  parseApiTokenScopes,
  parseStoredApiTokenFormIds,
} from "@nexus-form/shared";
import { and, count, desc, eq } from "drizzle-orm";
import type { CreateTokenRequest, TokenScope } from "../../types/api/auth";
import { computeLookupHash, hashToken } from "./hash";
import { requireStoredApiTokenJson } from "./stored-json";

/**
 * セキュアなAPIトークンを生成する
 * @returns 生成されたトークン（プレーンテキスト）
 */
export function generateSecureToken(): string {
  // 32バイト（256ビット）のランダムトークンを生成
  const randomToken = randomBytes(32);
  // Base64エンコードしてプレフィックスを追加
  const base64Token = randomToken.toString("base64");
  return `ct_${base64Token}`;
}

/**
 * APIトークンを作成する
 * @param userId ユーザーID
 * @param params トークン作成パラメータ
 * @returns 作成されたトークン情報
 */
export async function createApiToken(
  userId: string,
  params: CreateTokenRequest,
): Promise<{
  id: string;
  name: string;
  token: string;
  tokenHash: string;
  scopes: TokenScope[];
  formIds?: string[];
  expiresAt?: Date;
  createdAt: Date;
}> {
  // プレーンテキストトークンを生成
  const plainToken = generateSecureToken();

  // トークンをハッシュ化
  const tokenHash = await hashToken(plainToken);
  const lookupHash = computeLookupHash(plainToken);

  // 有効期限の処理
  const expiresAt = params.expires_at ? new Date(params.expires_at) : undefined;
  const scopes = parseApiTokenScopes(params.scopes);
  const formIds = parseStoredApiTokenFormIds(params.form_ids);

  // データベースに保存
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(apiToken).values({
    id,
    userId,
    name: params.name,
    tokenHash,
    lookupHash,
    scopes,
    formIds,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    name: params.name,
    token: plainToken, // プレーンテキストは作成時のみ返す
    tokenHash,
    scopes,
    formIds,
    expiresAt,
    createdAt: now,
  };
}

/**
 * ユーザーのAPIトークン一覧を取得する
 * @param userId ユーザーID
 * @param page ページ番号（1から開始）
 * @param pageSize ページサイズ
 * @returns トークン一覧とページネーション情報
 */
export async function getUserApiTokens(
  userId: string,
  page: number = 1,
  pageSize: number = 20,
) {
  const offset = (page - 1) * pageSize;

  const whereCondition = and(
    eq(apiToken.userId, userId),
    eq(apiToken.isActive, true),
  );

  const [tokens, totalResult] = await Promise.all([
    db
      .select({
        id: apiToken.id,
        name: apiToken.name,
        scopes: apiToken.scopes,
        formIds: apiToken.formIds,
        expiresAt: apiToken.expiresAt,
        lastUsedAt: apiToken.lastUsedAt,
        createdAt: apiToken.createdAt,
        isActive: apiToken.isActive,
      })
      .from(apiToken)
      .where(whereCondition)
      .orderBy(desc(apiToken.createdAt))
      .offset(offset)
      .limit(pageSize),
    db.select({ total: count() }).from(apiToken).where(whereCondition),
  ]);

  const mappedTokens = tokens.map((token) => {
    const parsedJson = requireStoredApiTokenJson(token, "getUserApiTokens");
    return {
      id: token.id,
      name: token.name,
      scopes: parsedJson.scopes,
      form_ids: parsedJson.formIds,
      expires_at: token.expiresAt?.toISOString(),
      last_used_at: token.lastUsedAt?.toISOString(),
      created_at: token.createdAt.toISOString(),
      is_active: token.isActive,
    };
  });
  const total = totalResult[0]?.total ?? 0;

  return {
    tokens: mappedTokens,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page * pageSize < total,
      hasPrev: page > 1,
    },
  };
}

/**
 * APIトークンを削除する
 * @param tokenId トークンID
 * @param userId ユーザーID（所有権確認用）
 * @returns 削除成功かどうか
 */
export async function deleteApiToken(
  tokenId: string,
  userId: string,
): Promise<boolean> {
  // 対象トークンの存在確認
  const existing = await db
    .select({ id: apiToken.id })
    .from(apiToken)
    .where(
      and(
        eq(apiToken.id, tokenId),
        eq(apiToken.userId, userId),
        eq(apiToken.isActive, true),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return false;
  }

  await db
    .delete(apiToken)
    .where(
      and(
        eq(apiToken.id, tokenId),
        eq(apiToken.userId, userId),
        eq(apiToken.isActive, true),
      ),
    );

  return true;
}

/**
 * APIトークンを無効化する
 * @param tokenId トークンID
 * @param userId ユーザーID（所有権確認用）
 * @returns 無効化成功かどうか
 */
export async function revokeApiToken(
  tokenId: string,
  userId: string,
): Promise<boolean> {
  // 対象トークンの存在確認
  const existing = await db
    .select({ id: apiToken.id })
    .from(apiToken)
    .where(
      and(
        eq(apiToken.id, tokenId),
        eq(apiToken.userId, userId),
        eq(apiToken.isActive, true),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return false;
  }

  await db
    .update(apiToken)
    .set({
      isActive: false,
      revokedAt: new Date(),
    })
    .where(
      and(
        eq(apiToken.id, tokenId),
        eq(apiToken.userId, userId),
        eq(apiToken.isActive, true),
      ),
    );

  return true;
}
