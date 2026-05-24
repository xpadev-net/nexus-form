import { randomBytes } from "node:crypto";
import { db } from "@nexus-form/database";
import { apiToken } from "@nexus-form/database/schema";
import {
  API_TOKEN_FORM_IDS_MAX,
  parseApiTokenScopes,
  parseStoredApiTokenFormIds,
} from "@nexus-form/shared";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { CreateTokenRequest, TokenScope } from "../../types/api/auth";
import { computeLookupHash, hashToken } from "./hash";
import { parseStoredApiTokenJson } from "./stored-json";

const parseableApiTokenJsonCondition = sql`
  JSON_TYPE(${apiToken.scopes}) = 'ARRAY'
    AND JSON_LENGTH(${apiToken.scopes}) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(
        ${apiToken.scopes},
        '$[*]' COLUMNS(scope_value JSON PATH '$')
      ) AS api_token_scope_values
      WHERE JSON_TYPE(api_token_scope_values.scope_value) IS NULL
        OR JSON_TYPE(api_token_scope_values.scope_value) != 'STRING'
        OR JSON_UNQUOTE(api_token_scope_values.scope_value) NOT IN ('read', 'write', 'admin')
    )
    AND (
      ${apiToken.formIds} IS NULL
      OR JSON_TYPE(${apiToken.formIds}) = 'NULL'
      OR (
        JSON_TYPE(${apiToken.formIds}) = 'ARRAY'
        AND JSON_LENGTH(${apiToken.formIds}) > 0
        AND JSON_LENGTH(${apiToken.formIds}) <= ${API_TOKEN_FORM_IDS_MAX}
        AND NOT EXISTS (
          SELECT 1
          FROM JSON_TABLE(
            ${apiToken.formIds},
            '$[*]' COLUMNS(form_id_value JSON PATH '$')
          ) AS api_token_form_id_values
          WHERE JSON_TYPE(api_token_form_id_values.form_id_value) IS NULL
            OR JSON_TYPE(api_token_form_id_values.form_id_value) != 'STRING'
            OR JSON_UNQUOTE(api_token_form_id_values.form_id_value) = ''
        )
      )
    )
`;

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
 * ユーザーのAPIトークン一覧を取得する。
 * DB 側の COUNT/LIMIT/OFFSET でページ境界を確定し、現在ページ分の行のみ JSON を parse する。
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
    parseableApiTokenJsonCondition,
  );

  const { total, pageTokens } = await db.transaction(async (tx) => {
    const [countRow] = await tx
      .select({ total: count() })
      .from(apiToken)
      .where(whereCondition);
    const total = Number(countRow?.total ?? 0);

    const pageTokens = await tx
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
      .orderBy(desc(apiToken.createdAt), desc(apiToken.id))
      .limit(pageSize)
      .offset(offset);

    return { total, pageTokens };
  });

  const mappedTokens = pageTokens.flatMap((token) => {
    const parsedJson = parseStoredApiTokenJson(token, "getUserApiTokens.page");
    if (!parsedJson) {
      return [];
    }

    return [
      {
        id: token.id,
        name: token.name,
        scopes: parsedJson.scopes,
        form_ids: parsedJson.formIds ?? null,
        expires_at: token.expiresAt?.toISOString(),
        last_used_at: token.lastUsedAt?.toISOString(),
        created_at: token.createdAt.toISOString(),
        is_active: token.isActive,
      },
    ];
  });

  return {
    tokens: mappedTokens,
    total,
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
