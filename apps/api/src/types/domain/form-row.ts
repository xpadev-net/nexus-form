import { FormStatus } from "@nexus-form/shared";
import { z } from "zod";

export {
  type ErrorResponse,
  ErrorResponseSchema,
  errorResponse,
} from "./common";

import { isoDate } from "./iso-date";

/**
 * Form テーブル行のレスポンススキーマ。
 * 列構成は `form.$inferSelect`（Drizzle 推論型）と一致し、
 * 日時列は ISO 文字列として出力する。
 */
export const FormRowSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  creatorId: z.string(),
  status: FormStatus,
  publishedAt: isoDate.nullable(),
  unpublishedAt: isoDate.nullable(),
  allowEditResponses: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
  version: z.number().int(),
  plateContent: z.string().nullable(),
  plateContentVersion: z.number().int(),
  baseSnapshotVersion: z.number().int().nullable(),
});
export type FormRow = z.infer<typeof FormRowSchema>;

/** GET / （フォーム一覧）のレスポンス。 */
export const FormsListResponseSchema = z.object({
  forms: z.array(FormRowSchema),
  pagination: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export type FormsListResponse = z.infer<typeof FormsListResponseSchema>;

/** POST / （フォーム作成）のレスポンス。 */
export const FormCreateResponseSchema = z.object({
  form: FormRowSchema,
});
export type FormCreateResponse = z.infer<typeof FormCreateResponseSchema>;

/**
 * FormResponse テーブル行のレスポンススキーマ。
 * 列構成は `formResponse.$inferSelect`（Drizzle 推論型）と一致し、
 * 日時列は ISO 文字列として出力する。
 */
export const FormResponseRowSchema = z.object({
  id: z.string(),
  formId: z.string(),
  responseDataJson: z.string(),
  submittedAt: isoDate,
  updatedAt: isoDate.nullable(),
  respondentUuid: z.string(),
  userAgent: z.string().nullable(),
  sessionId: z.string().nullable(),
  countryCode: z.string().nullable(),
});
export type FormResponseRow = z.infer<typeof FormResponseRowSchema>;

/** GET /:id （フォーム詳細）のレスポンス。 */
export const FormDetailResponseSchema = z.object({
  form: FormRowSchema,
});
export type FormDetailResponse = z.infer<typeof FormDetailResponseSchema>;

/** PUT /:id・GET /:id/export 等、フォームが存在しないこともあるレスポンス。 */
export const FormNullableResponseSchema = z.object({
  form: FormRowSchema.nullable(),
});
export type FormNullableResponse = z.infer<typeof FormNullableResponseSchema>;

/** GET /:id/preview のレスポンス。 */
export const FormPreviewResponseSchema = z.object({
  form: FormRowSchema.nullable(),
  preview: z.literal(true),
});
export type FormPreviewResponse = z.infer<typeof FormPreviewResponseSchema>;

/** `{ ok: true }` のみを返すミューテーション系レスポンス。 */
export const OkResponseSchema = z.object({
  ok: z.literal(true),
});
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** POST /:id/regenerate-public-url のレスポンス。 */
export const RegeneratePublicUrlResponseSchema = z.object({
  publicId: z.string(),
});
export type RegeneratePublicUrlResponse = z.infer<
  typeof RegeneratePublicUrlResponseSchema
>;

/** POST /:id/transfer-ownership のレスポンス。 */
export const TransferOwnershipResponseSchema = z.object({
  ok: z.literal(true),
  ownerUserId: z.string(),
});
export type TransferOwnershipResponse = z.infer<
  typeof TransferOwnershipResponseSchema
>;
