import { z } from "zod";

// APIトークンの権限スコープ
export const TokenScope = z.enum(["read", "write", "admin"]);

export type TokenScope = z.infer<typeof TokenScope>;

// APIトークンの型
export const ApiToken = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  token: z.string().optional(), // 作成時のみ返される
  scopes: z.array(TokenScope),
  form_ids: z.array(z.string()).optional(), // 特定フォームのみアクセス可能な場合
  expires_at: z.string().optional(), // ISO datetime
  created_at: z.string(), // ISO datetime
  last_used_at: z.string().optional(), // ISO datetime
  is_active: z.boolean().default(true),
});

export type ApiToken = z.infer<typeof ApiToken>;

// APIトークン作成リクエスト
export const CreateTokenRequest = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(TokenScope).min(1),
  form_ids: z.array(z.string()).optional(),
  expires_at: z.string().optional(), // ISO datetime
});

export type CreateTokenRequest = z.infer<typeof CreateTokenRequest>;

// APIトークン作成レスポンス
export const CreateTokenResponse = z.object({
  token: ApiToken,
  message: z.string(),
});

export type CreateTokenResponse = z.infer<typeof CreateTokenResponse>;

// ページネーション情報
export const PaginationInfo = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type PaginationInfo = z.infer<typeof PaginationInfo>;

// APIトークン一覧取得レスポンス
export const GetTokensResponse = z.object({
  tokens: z.array(ApiToken),
  total: z.number(),
  pagination: PaginationInfo.optional(),
});

export type GetTokensResponse = z.infer<typeof GetTokensResponse>;

// APIトークン削除リクエスト
export const DeleteTokenRequest = z.object({
  id: z.string(),
});

export type DeleteTokenRequest = z.infer<typeof DeleteTokenRequest>;

// APIトークン削除レスポンス
export const DeleteTokenResponse = z.object({
  message: z.string(),
});

export type DeleteTokenResponse = z.infer<typeof DeleteTokenResponse>;

// APIトークン無効化リクエスト
export const RevokeTokenRequest = z.object({
  id: z.string(),
});

export type RevokeTokenRequest = z.infer<typeof RevokeTokenRequest>;

// APIトークン無効化レスポンス
export const RevokeTokenResponse = z.object({
  message: z.string(),
});

export type RevokeTokenResponse = z.infer<typeof RevokeTokenResponse>;

// 認証エラー
export const AuthError = z.object({
  code: z.enum([
    "INVALID_TOKEN",
    "EXPIRED_TOKEN",
    "INSUFFICIENT_SCOPE",
    "TOKEN_NOT_FOUND",
  ]),
  message: z.string(),
  required_scopes: z.array(TokenScope).optional(),
});

export type AuthError = z.infer<typeof AuthError>;

// API認証ミドルウェアのコンテキスト
export const AuthContext = z.object({
  user_id: z.string().nullable(),
  token_id: z.string().optional(),
  scopes: z.array(TokenScope),
  form_ids: z.array(z.string()).optional(),
  is_admin: z.boolean(),
});

export type AuthContext = z.infer<typeof AuthContext>;
