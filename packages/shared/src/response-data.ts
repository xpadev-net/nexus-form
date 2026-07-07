/**
 * フォーム回答データの個別項目を表す共通型・共通スキーマ。
 * API (response-validator, route schemas) と Worker (response-data-extractor) の両方で使用する。
 */

import { z } from "zod";
import {
  ANSWERABLE_BLOCK_TYPES,
  type AnswerableBlockTypeValue,
  PatternMismatchMode,
  ShortTextCompatibleValidationConfig,
} from "./forms/form-block";

/** ユーザー回答を受け付けるバリデーション対象の質問タイプ。 */
export const ANSWERABLE_QUESTION_TYPES = ANSWERABLE_BLOCK_TYPES;

/** バリデーション対象の質問タイプのユニオン型。 */
export type AnswerableQuestionType = AnswerableBlockTypeValue;

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
    patternMismatchMode: PatternMismatchMode.optional(),
    allowPatternMismatch: z.boolean().optional(),
    otherTextValidation: ShortTextCompatibleValidationConfig.optional(),
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

export const MAX_RESPONSE_ITEMS = 500;
export const MAX_RESPONSE_BODY_BYTES = 512 * 1024;
export const MAX_RESPONSE_DATA_JSON_BYTES = 65_535;
export const MAX_RESPONSE_ID_LENGTH = 200;
export const MAX_RESPONSE_TITLE_LENGTH = 1_000;
export const MAX_RESPONSE_TEXT_LENGTH = 10_000;
export const MAX_RESPONSE_SELECTIONS = 200;
export const MAX_RESPONSE_GRID_ROWS = 200;
export const MAX_RESPONSE_GRID_SELECTIONS_PER_ROW = 200;

export function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const responseTextSchema = z.string().max(MAX_RESPONSE_TEXT_LENGTH);
const responseScalarSchema = z.union([
  responseTextSchema,
  z.number(),
  z.boolean(),
  z.null(),
]);
const responseSelectionSchema = z.union([
  responseTextSchema,
  z.number(),
  z.boolean(),
]);

export const PATTERN_MATCH_STATUSES = [
  "match",
  "mismatch",
  "unchecked",
] as const;

export const PatternMatchStatus = z.enum(PATTERN_MATCH_STATUSES);
export type PatternMatchStatus = z.infer<typeof PatternMatchStatus>;

export const responsePatternMatchMetadataSchema = z.object({
  status: PatternMatchStatus,
  mode: PatternMismatchMode.optional(),
  pattern: z.string().optional(),
  patternTemplate: z.string().optional(),
});

export type ResponsePatternMatchMetadata = z.infer<
  typeof responsePatternMatchMetadataSchema
>;

export const responseItemValidationMetadataSchema = z
  .object({
    pattern_match: responsePatternMatchMetadataSchema.optional(),
    other_text_pattern_match: responsePatternMatchMetadataSchema.optional(),
  })
  .passthrough();

export type ResponseItemValidationMetadata = z.infer<
  typeof responseItemValidationMetadataSchema
>;

function validateGridResponseItem(
  item: { question_type: string; responses?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  if (!item.responses) return;
  if (item.question_type === "choice_grid") {
    for (const [rowId, value] of Object.entries(item.responses)) {
      if (typeof value !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["responses", rowId],
          message: "choice_grid rows must contain a single selection string",
        });
      }
    }
  }
  if (item.question_type === "checkbox_grid") {
    for (const [rowId, value] of Object.entries(item.responses)) {
      if (!Array.isArray(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["responses", rowId],
          message: "checkbox_grid rows must contain selection arrays",
        });
      }
    }
  }
}

/** 回答ペイロードの個別項目を検証する Zod スキーマ */
const responsePayloadItemBaseSchema = z.object({
  question_id: z.string().min(1).max(MAX_RESPONSE_ID_LENGTH),
  question_type: z.string().min(1).max(MAX_RESPONSE_ID_LENGTH),
  question_title: z.string().max(MAX_RESPONSE_TITLE_LENGTH).optional(),
  value: responseScalarSchema.optional(),
  values: z
    .array(responseSelectionSchema)
    .max(MAX_RESPONSE_SELECTIONS)
    .optional(),
  responses: z
    .record(
      z.string().min(1).max(MAX_RESPONSE_ID_LENGTH),
      z.union([
        responseTextSchema,
        z.array(responseTextSchema).max(MAX_RESPONSE_GRID_SELECTIONS_PER_ROW),
      ]),
    )
    .refine(
      (responses) => Object.keys(responses).length <= MAX_RESPONSE_GRID_ROWS,
      {
        message: `Cannot include more than ${MAX_RESPONSE_GRID_ROWS} response rows`,
      },
    )
    .optional(),
  other_value: responseTextSchema.optional(),
  other_values: z
    .array(responseTextSchema)
    .max(MAX_RESPONSE_SELECTIONS)
    .optional(),
});

export const responsePayloadItemSchema =
  responsePayloadItemBaseSchema.superRefine(validateGridResponseItem);

export const responseDataItemSchema = responsePayloadItemBaseSchema
  .extend({
    validation_metadata: responseItemValidationMetadataSchema.optional(),
  })
  .superRefine(validateGridResponseItem);

/** 回答投稿ペイロードと保存済み回答データの個別項目の型。 */
export type ResponsePayloadItem = z.infer<typeof responsePayloadItemSchema>;
export type ResponseDataItem = z.infer<typeof responseDataItemSchema>;
