import { FormStatus } from "@nexus-form/shared";
import { z } from "zod";

/**
 * Form テーブル行のレスポンススキーマ。
 * `form.$inferSelect`（Drizzle 推論型）と一致する。
 */
export const FormRowSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  creatorId: z.string(),
  status: FormStatus,
  publishedAt: z.date().nullable(),
  unpublishedAt: z.date().nullable(),
  allowEditResponses: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  version: z.number().int(),
  plateContent: z.string().nullable(),
  plateContentVersion: z.number().int(),
  baseSnapshotVersion: z.number().int().nullable(),
});
export type FormRow = z.infer<typeof FormRowSchema>;

/** GET / （フォーム一覧）のレスポンス。 */
export const FormsListResponseSchema = z.object({
  forms: z.array(FormRowSchema),
});
export type FormsListResponse = z.infer<typeof FormsListResponseSchema>;

/** POST / （フォーム作成）のレスポンス。 */
export const FormCreateResponseSchema = z.object({
  form: FormRowSchema,
});
export type FormCreateResponse = z.infer<typeof FormCreateResponseSchema>;
