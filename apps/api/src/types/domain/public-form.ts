import { FormConfirmationSchema, FormStatus } from "@nexus-form/shared";
import { z } from "zod";
import { FormResponseRowSchema } from "./form-row";

/**
 * 公開フォーム UI 向けに whitelist フィルタした構造。
 * `buildPublicFormStructure` の戻り値に対応する。
 * settings / logic / appearance / confirmation は内部的に緩い型のため
 * `z.unknown()` / `z.record()` で受ける。
 */
export const PublicFormStructureSchema = z.object({
  version: z.number().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  logic: z.array(z.unknown()).optional(),
  appearance: z.unknown().optional(),
  confirmation: FormConfirmationSchema.optional(),
});
export type PublicFormStructure = z.infer<typeof PublicFormStructureSchema>;

/** GET /public/:publicId のレスポンス。 */
export const PublicFormResponseSchema = z.object({
  form: z.object({
    id: z.string(),
    publicId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: FormStatus,
    isPasswordProtected: z.boolean(),
    passwordHint: z.string().optional(),
  }),
  structure: PublicFormStructureSchema.nullable(),
  plateContent: z.string().nullable(),
});
export type PublicFormResponse = z.infer<typeof PublicFormResponseSchema>;

/** POST /public/:publicId/submit のレスポンス。 */
export const PublicSubmitResponseSchema = z.object({
  responseId: z.string(),
  response: FormResponseRowSchema.nullable(),
  confirmation: FormConfirmationSchema,
});
export type PublicSubmitResponse = z.infer<typeof PublicSubmitResponseSchema>;

/** POST /public/:publicId/submit の回答上限到達レスポンス。 */
export const PublicSubmitLimitErrorResponseSchema = z.object({
  error: z.string(),
  responseLimitReached: z.literal(true),
});
export type PublicSubmitLimitErrorResponse = z.infer<
  typeof PublicSubmitLimitErrorResponseSchema
>;

/** POST /public/:publicId/verify-password のレスポンス。 */
export const VerifyPasswordResponseSchema = z.object({
  valid: z.boolean(),
});
export type VerifyPasswordResponse = z.infer<
  typeof VerifyPasswordResponseSchema
>;

/** パスワード保護フォームで検証済みセッションが必要な場合のレスポンス。 */
export const PasswordRequiredErrorResponseSchema = z.object({
  error: z.string(),
  passwordRequired: z.literal(true),
  passwordHint: z.string().optional(),
});
export type PasswordRequiredErrorResponse = z.infer<
  typeof PasswordRequiredErrorResponseSchema
>;

/** GET /shared/:token のレスポンス。 */
export const SharedFormResponseSchema = z.object({
  form: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }),
  role: z.enum(["EDITOR", "VIEWER"]),
  share_link: z.object({
    id: z.string(),
    form_id: z.string(),
    role: z.enum(["EDITOR", "VIEWER"]),
    is_active: z.boolean(),
    expires_at: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    created_by: z.string().nullable(),
  }),
});
export type SharedFormResponse = z.infer<typeof SharedFormResponseSchema>;
