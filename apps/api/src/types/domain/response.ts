import { z } from "zod";
import { BlockType } from "./form-block";

// 回答データの基本型
export const BaseResponse = z.object({
  question_id: z.string(),
  question_type: BlockType,
  question_title: z.string().optional(),
});

export type BaseResponse = z.infer<typeof BaseResponse>;

// 各質問タイプの回答データ
export const ShortTextResponse = BaseResponse.extend({
  question_type: z.literal("short_text"),
  value: z.string(),
});

export const LongTextResponse = BaseResponse.extend({
  question_type: z.literal("long_text"),
  value: z.string(),
});

export const RadioResponse = BaseResponse.extend({
  question_type: z.literal("radio"),
  value: z.string(),
  other_value: z.string().optional(),
});

export const CheckboxResponse = BaseResponse.extend({
  question_type: z.literal("checkbox"),
  values: z.array(z.string()),
  other_values: z.array(z.string()).optional(),
});

export const DropdownResponse = BaseResponse.extend({
  question_type: z.literal("dropdown"),
  value: z.string(),
  other_value: z.string().optional(),
});

export const LinearScaleResponse = BaseResponse.extend({
  question_type: z.literal("linear_scale"),
  value: z.number(),
});

export const RatingResponse = BaseResponse.extend({
  question_type: z.literal("rating"),
  value: z.number(),
});

export const ChoiceGridResponse = BaseResponse.extend({
  question_type: z.literal("choice_grid"),
  responses: z.record(z.string(), z.string()), // row_id -> column_id
});

export const CheckboxGridResponse = BaseResponse.extend({
  question_type: z.literal("checkbox_grid"),
  responses: z.record(z.string(), z.array(z.string())), // row_id -> [column_ids]
});

export const DateResponse = BaseResponse.extend({
  question_type: z.literal("date"),
  value: z.string(), // ISO date string
});

export const TimeResponse = BaseResponse.extend({
  question_type: z.literal("time"),
  value: z.string(), // HH:MM format
});

// 回答データのユニオン型
export const ResponseData = z.discriminatedUnion("question_type", [
  ShortTextResponse,
  LongTextResponse,
  RadioResponse,
  CheckboxResponse,
  DropdownResponse,
  LinearScaleResponse,
  RatingResponse,
  ChoiceGridResponse,
  CheckboxGridResponse,
  DateResponse,
  TimeResponse,
]);

export type ResponseData = z.infer<typeof ResponseData>;

// フィンガープリントの型
export const FingerprintType = z.enum([
  "user_agent",
  "canvas",
  "webgl",
  "screen_resolution",
  "timezone",
  "language",
  "fonts",
  "plugins",
  "cookies",
  "local_storage",
  "ip_address",
]);

export type FingerprintType = z.infer<typeof FingerprintType>;

export const FingerprintData = z.object({
  type: FingerprintType,
  value_hash: z.string(), // ハッシュ化された値
  collected_at: z.string(), // ISO datetime
});

export type FingerprintData = z.infer<typeof FingerprintData>;

// 外部検証結果
export const ExternalValidationResult = z.object({
  service: z.string(),
  username: z.string(),
  is_valid: z.boolean(),
  metadata: z.record(z.string(), z.any()).optional(),
  validated_at: z.string(), // ISO datetime
  display_to_user: z.boolean(),
});

export type ExternalValidationResult = z.infer<typeof ExternalValidationResult>;

// 重複検出結果
export const DuplicateDetectionResult = z.object({
  is_duplicate: z.boolean(),
  confidence_score: z.number().min(0).max(1),
  matched_responses: z.array(z.string()).optional(), // 一致した回答ID
  fingerprint_matches: z.array(FingerprintType).optional(),
  detected_at: z.string(), // ISO datetime
});

export type DuplicateDetectionResult = z.infer<typeof DuplicateDetectionResult>;

// 回答メタデータ
export const ResponseMetadata = z.object({
  id: z.string(),
  form_id: z.string(),
  respondent_uuid: z.string(),
  submitted_at: z.string(), // ISO datetime
  updated_at: z.string().optional(), // ISO datetime
  ip_address_hash: z.string().optional(),
  user_agent: z.string().optional(),
  fingerprint_hash: z.string().optional(),
  session_alias: z.string().optional(), // セッションエイリアス（フォーム間で一意）
});

export type ResponseMetadata = z.infer<typeof ResponseMetadata>;

// 回答全体
export const Response = z.object({
  metadata: ResponseMetadata,
  responses: z.array(ResponseData),
  fingerprints: z.array(FingerprintData).optional(),
  external_validations: z.array(ExternalValidationResult).optional(),
  duplicate_detection: DuplicateDetectionResult.optional(),
});

export type Response = z.infer<typeof Response>;

// 回答一覧取得レスポンス
export const ResponseListResponse = z.object({
  responses: z.array(Response),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export type ResponseListResponse = z.infer<typeof ResponseListResponse>;

// 回答統計データ
export const ResponseStatistics = z.object({
  total_responses: z.number(),
  unique_respondents: z.number(),
  duplicate_responses: z.number(),
  completion_rate: z.number().min(0).max(1),
  average_completion_time: z.number().optional(), // 秒
  response_timeline: z.array(
    z.object({
      date: z.string(),
      count: z.number(),
    }),
  ),
});

export type ResponseStatistics = z.infer<typeof ResponseStatistics>;
