import { z } from "zod";
import {
  FormAccessControlSchema,
  FormAppearanceSchema,
  FormConfirmationSchema,
  FormNotificationsSchema,
  StoredLogicRuleSchema,
} from "../validation/form";
import { FormSettingsSchema, FormStatus } from "../validation/shared";

export type { FormStatus as FormStatusType };
// Re-export types from validation schemas
export { FormStatus };

// フォーム構造（domain版 - 設定情報のみを保持、blocksは別テーブルで管理）
export const FormStructure = z.object({
  version: z.number().int().min(1).default(1),
  settings: FormSettingsSchema,
  logic: z.array(StoredLogicRuleSchema).optional(),
  confirmation: FormConfirmationSchema.optional(),
  notifications: FormNotificationsSchema.optional(),
  appearance: FormAppearanceSchema.optional(),
  access_control: FormAccessControlSchema.optional(),
});

export type FormStructure = z.infer<typeof FormStructure>;

// フォームスケジュールアクション
export const FormScheduleAction = z.enum([
  "PUBLISH",
  "UNPUBLISH",
  "SWITCH_SNAPSHOT",
]);
export type FormScheduleAction = z.infer<typeof FormScheduleAction>;

// フォームスケジュール
export const FormSchedule = z.object({
  id: z.string(),
  form_id: z.string(),
  trigger_at: z.string(),
  action: FormScheduleAction,
  snapshot_version: z.number().int().min(1).optional(),
  processed_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type FormSchedule = z.infer<typeof FormSchedule>;

// フォームメタデータ（domain版 - snake_case統一）
export const FormMetadata = z.object({
  id: z.string(),
  public_id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  creator_id: z.string(),
  status: FormStatus,
  created_at: z.string(),
  updated_at: z.string(),
  published_at: z.string().optional(),
  unpublished_at: z.string().optional(),
  version: z.number().int().min(1).default(1),
  response_count: z.number().int().nonnegative().optional(),
  schedules: z.array(FormSchedule).optional(),
});

export type FormMetadata = z.infer<typeof FormMetadata>;

// フォーム全体の型
export const Form = z.object({
  metadata: FormMetadata,
  structure: FormStructure,
});

export type Form = z.infer<typeof Form>;

// フォーム一覧取得レスポンス
export const FormListResponse = z.object({
  forms: z.array(FormMetadata),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export type FormListResponse = z.infer<typeof FormListResponse>;

// フォーム詳細取得レスポンス
export const FormDetailResponse = Form;

export type FormDetailResponse = z.infer<typeof FormDetailResponse>;
