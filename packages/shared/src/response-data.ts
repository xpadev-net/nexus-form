/**
 * フォーム回答データの個別項目を表す共通型・共通スキーマ。
 * API (response-validator, route schemas) と Worker (response-data-extractor) の両方で使用する。
 */

import { z } from "zod";

/** ユーザー回答を受け付けるバリデーション対象の質問タイプ。 */
export const ANSWERABLE_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "radio",
  "checkbox",
  "dropdown",
  "linear_scale",
  "rating",
  "choice_grid",
  "checkbox_grid",
  "date",
  "time",
] as const;

/** バリデーション対象の質問タイプのユニオン型。 */
export type AnswerableQuestionType = (typeof ANSWERABLE_QUESTION_TYPES)[number];

/** Zod スキーマ: 質問に設定されるバリデーションルール。 */
export const questionValidationSchema = z
  .object({
    required: z.boolean().optional(),
    type: z.string().optional(),
    minSelections: z.number().optional(),
    maxSelections: z.number().optional(),
    minSelectionsPerRow: z.number().optional(),
    maxSelectionsPerRow: z.number().optional(),
    allowOther: z.boolean().optional(),
    options: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .optional(),
    rows: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    minDate: z.string().optional(),
    maxDate: z.string().optional(),
    minTime: z.string().optional(),
    maxTime: z.string().optional(),
    pattern: z.string().optional(),
    allowPatternMismatch: z.boolean().optional(),
  })
  .passthrough();

/** 質問に設定されるバリデーションルールの型。 */
export type QuestionValidation = z.infer<typeof questionValidationSchema>;

/**
 * response-validator が期待する質問定義の型。
 * API (plate-question-builder, response-validator) の両方で使用する。
 */
export interface ValidatorQuestion {
  id: string;
  type: AnswerableQuestionType;
  validation?: QuestionValidation;
}

/** 回答ペイロードの個別項目を検証する Zod スキーマ */
export const responsePayloadItemSchema = z.object({
  question_id: z.string().min(1),
  question_type: z.string().min(1),
  question_title: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  responses: z.record(z.string(), z.array(z.string())).optional(),
  other_value: z.string().optional(),
  other_values: z.array(z.string()).optional(),
});

/** 回答データの個別項目の型。responsePayloadItemSchema から導出。 */
export type ResponseDataItem = z.infer<typeof responsePayloadItemSchema>;
