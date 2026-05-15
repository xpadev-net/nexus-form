import { z } from "zod";
import { PaginationSchema } from "./pagination";

/** API トークンのスコープ。 */
export const ApiTokenScopeSchema = z.enum(["read", "write", "admin"]);

/**
 * API トークンの公開サマリ（秘密値を含まない）。
 * ルートが日時を `.toISOString()` 済みのため日時フィールドは文字列。
 */
export const ApiTokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(ApiTokenScopeSchema),
  form_ids: z.array(z.string()).nullish(),
  expires_at: z.string().optional(),
  last_used_at: z.string().optional(),
  created_at: z.string(),
  is_active: z.boolean(),
});
export type ApiTokenSummary = z.infer<typeof ApiTokenSummarySchema>;

/** 作成直後のみ返る、平文トークンを含むトークン表現。 */
export const ApiTokenWithSecretSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  scopes: z.array(ApiTokenScopeSchema),
  form_ids: z.array(z.string()).nullish(),
  expires_at: z.string().optional(),
  created_at: z.string(),
  is_active: z.boolean(),
});
export type ApiTokenWithSecret = z.infer<typeof ApiTokenWithSecretSchema>;

/** GET /tokens のレスポンス。 */
export const TokenListResponseSchema = z.object({
  tokens: z.array(ApiTokenSummarySchema),
  total: z.number().int(),
  pagination: PaginationSchema,
});
export type TokenListResponse = z.infer<typeof TokenListResponseSchema>;

/** POST /tokens のレスポンス。 */
export const TokenCreateResponseSchema = z.object({
  token: ApiTokenWithSecretSchema,
  message: z.string(),
});
export type TokenCreateResponse = z.infer<typeof TokenCreateResponseSchema>;

/** GET /tokens/:id のレスポンス。 */
export const TokenDetailResponseSchema = z.object({
  token: ApiTokenSummarySchema,
});
export type TokenDetailResponse = z.infer<typeof TokenDetailResponseSchema>;

/** PATCH /tokens/:id のレスポンス。 */
export const TokenUpdateResponseSchema = z.object({
  token: ApiTokenSummarySchema,
  message: z.string(),
});
export type TokenUpdateResponse = z.infer<typeof TokenUpdateResponseSchema>;

/** メッセージのみを返すレスポンス（delete / revoke）。 */
export const MessageResponseSchema = z.object({
  message: z.string(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

/** POST /tokens/validate のレスポンス。 */
export const TokenValidateResponseSchema = z.object({
  valid: z.literal(true),
  user_id: z.string(),
  scopes: z.array(ApiTokenScopeSchema),
});
export type TokenValidateResponse = z.infer<typeof TokenValidateResponseSchema>;
