/**
 * 共有型定義のZodバリデーションスキーマ
 * 複数のドメインで使用される共通のバリデーション
 */

import { z } from "zod";
import { FORM_STATUS_VALUES } from "../constants/status";

// FormStatus is defined here to avoid circular dependencies
export const FormStatus = z.enum(FORM_STATUS_VALUES);

export type FormStatus = z.infer<typeof FormStatus>;

// フォーム設定スキーマ
export const FormSettingsSchema = z.object({
  allow_edit_responses: z.boolean().default(false),
  require_fingerprint: z.boolean().optional(),
  privacy_notice: z
    .string()
    .max(1000, "プライバシー注意書きは1000文字以内で入力してください")
    .optional(),
  response_limit: z
    .object({
      enabled: z.boolean(),
      max_responses: z.number().int().min(1).max(100000),
      message: z.string().max(500).optional(),
    })
    .optional(),
  autosave: z
    .object({
      enabled: z.boolean(),
      interval_seconds: z.number().int().min(10).max(600).default(30),
    })
    .optional(),
});

// フォームメタデータスキーマ（snake_case統一）
export const FormMetadataSchema = z.object({
  id: z.string().min(1, "フォームIDは必須です"),
  title: z
    .string()
    .min(1, "フォームタイトルは必須です")
    .max(200, "フォームタイトルは200文字以内で入力してください"),
  description: z
    .string()
    .max(500, "説明は500文字以内で入力してください")
    .optional(),
  creator_id: z.string().min(1, "作成者IDは必須です"),
  status: FormStatus,
  published_at: z.string().datetime().optional(),
  unpublished_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  version: z.number().int().min(1),
});

const StoredLogicConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.string().min(1),
  value: z.unknown().optional(),
});

const StoredLogicActionSchema = z.object({
  type: z.string().min(1),
  targetBlockId: z.string().min(1).optional(),
});

// フォーム構造のトップレベル logic 配列で使用するスキーマ。
// フロントエンドのロジックエディタから送信される shape を明示的に検証する。
// セクションレベルの navigation_rules には FormLogicRuleSchema（各 app で定義）を使用。
export const StoredLogicRuleSchema = z.object({
  id: z.string(),
  sourceBlockId: z.string(),
  condition: StoredLogicConditionSchema,
  action: StoredLogicActionSchema,
  priority: z.number().int().min(0),
  isActive: z.boolean(),
});

// 型推論用の型エクスポート
export type FormSettings = z.infer<typeof FormSettingsSchema>;
export type FormMetadata = z.infer<typeof FormMetadataSchema>;
export type StoredLogicRule = z.infer<typeof StoredLogicRuleSchema>;
