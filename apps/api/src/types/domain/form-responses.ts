import { z } from "zod";
import { FormResponseRowSchema } from "./form-row";

/** GET /:id/responses のリストアイテム（responseDataJson を含まない）。 */
export const ResponseListItemSchema = FormResponseRowSchema.omit({
  responseDataJson: true,
}).extend({
  uniquenessScore: z.number().min(0).max(1).nullable(),
});
export type ResponseListItem = z.infer<typeof ResponseListItemSchema>;

/** GET /:id/responses のレスポンス。 */
export const ResponsesListResponseSchema = z.object({
  responses: z.array(ResponseListItemSchema),
  page: z.number().int(),
  limit: z.number().int(),
  hasNext: z.boolean(),
});
export type ResponsesListResponse = z.infer<typeof ResponsesListResponseSchema>;

const PaginationMetadataSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  hasNext: z.boolean(),
});

/** POST /:id/responses / PUT /:id/responses/:responseId のレスポンス。 */
export const ResponseMutationResponseSchema = z.object({
  response: FormResponseRowSchema.nullable(),
});
export type ResponseMutationResponse = z.infer<
  typeof ResponseMutationResponseSchema
>;

/** 回答データ検証エラーのレスポンス。 */
export const InvalidResponseDataErrorResponseSchema = z.object({
  error: z.literal("Invalid response data"),
  details: z.array(z.string()),
});
export type InvalidResponseDataErrorResponse = z.infer<
  typeof InvalidResponseDataErrorResponseSchema
>;

/** GET /:id/responses/ids のレスポンス。 */
export const ResponseIdsResponseSchema = z.object({
  responseIds: z.array(z.string()),
  pagination: PaginationMetadataSchema,
});
export type ResponseIdsResponse = z.infer<typeof ResponseIdsResponseSchema>;

/** GET /:id/responses/statuses の 1 エントリ。 */
export const ValidationStatusCountSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "MISSING"]),
  count: z.number().int(),
});

/** GET /:id/responses/statuses のレスポンス。 */
export const ResponseStatusesResponseSchema = z.object({
  statuses: z.array(ValidationStatusCountSchema),
});
export type ResponseStatusesResponse = z.infer<
  typeof ResponseStatusesResponseSchema
>;

/** GET /:id/responses/aggregate のレスポンス。 */
export const ResponseAggregateResponseSchema = z.object({
  totalResponses: z.number().int(),
  uniqueRespondents: z.number().int(),
});
export type ResponseAggregateResponse = z.infer<
  typeof ResponseAggregateResponseSchema
>;

/** GET /:id/responses/analytics のレスポンス。 */
export const ResponseAnalyticsResponseSchema = z.object({
  timeline: z.array(
    z.object({
      date: z.iso.date(),
      count: z.number().int(),
    }),
  ),
  pagination: PaginationMetadataSchema,
});
export type ResponseAnalyticsResponse = z.infer<
  typeof ResponseAnalyticsResponseSchema
>;

// ===== ブロック分析サブスキーマ =====

const ChoiceOptionAnalyticsSchema = z.object({
  label: z.string(),
  count: z.number().int(),
  percentage: z.number(),
});

/** radio / checkbox / dropdown / linear_scale / rating のブロック集計。 */
const ChoiceAnalyticsSchema = z.object({
  total_responses: z.number().int(),
  options: z.array(ChoiceOptionAnalyticsSchema),
});

/** choice_grid / checkbox_grid のブロック集計。 */
const GridAnalyticsSchema = z.object({
  grid_type: z.enum(["choice_grid", "checkbox_grid"]),
  rows: z.array(z.object({ id: z.string(), label: z.string() })),
  columns: z.array(z.object({ id: z.string(), label: z.string() })),
  row_analytics: z.array(
    z.object({
      row_label: z.string(),
      column_counts: z.array(
        z.object({ column_id: z.string(), count: z.number().int() }),
      ),
    }),
  ),
  column_analytics: z.array(
    z.object({
      column_id: z.string(),
      column_label: z.string(),
      row_counts: z.array(
        z.object({ row_label: z.string(), count: z.number().int() }),
      ),
    }),
  ),
  total_responses: z.number().int(),
  response_rate: z.number(),
  invalid_responses: z.array(
    z.object({
      response_id: z.string(),
      reason: z.string(),
    }),
  ),
});

/** date ブロックの集計。 */
const DateAnalyticsSchema = z.object({
  block_id: z.string(),
  form_id: z.string(),
  total_responses: z.number().int(),
  distribution: z.array(
    z.object({
      date: z.string(),
      count: z.number().int(),
      percentage: z.number(),
    }),
  ),
  responses: z.array(
    z.object({
      response_id: z.string(),
      submitted_at: z.string(),
      date: z.string(),
    }),
  ),
});

/** time ブロックの集計。 */
const TimeAnalyticsSchema = z.object({
  block_id: z.string(),
  form_id: z.string(),
  total_responses: z.number().int(),
  distribution: z.array(
    z.object({
      time: z.string(),
      count: z.number().int(),
      percentage: z.number(),
    }),
  ),
  responses: z.array(
    z.object({
      response_id: z.string(),
      submitted_at: z.string(),
      time: z.string(),
    }),
  ),
});

/** short_text / long_text ブロックの集計。 */
const TextAnalyticsSchema = z.object({
  total_responses: z.number().int(),
  responses: z.array(
    z.object({
      response_id: z.string(),
      submitted_at: z.string(),
      value: z.string(),
    }),
  ),
  word_count_stats: z
    .object({
      average: z.number(),
      min: z.number().int(),
      max: z.number().int(),
    })
    .optional(),
});

/** GET /:id/responses/block-analytics の 1 ブロック。 */
export const BlockAnalyticsResultSchema = z.object({
  block_id: z.string(),
  block_type: z.string(),
  block_title: z.string(),
  total_responses: z.number().int(),
  response_rate: z.number(),
  analytics_data: z.union([
    ChoiceAnalyticsSchema,
    GridAnalyticsSchema,
    DateAnalyticsSchema,
    TimeAnalyticsSchema,
    TextAnalyticsSchema,
  ]),
});

/** GET /:id/responses/block-analytics のレスポンス。 */
export const BlockAnalyticsResponseSchema = z.object({
  blocks: z.array(BlockAnalyticsResultSchema),
});
export type BlockAnalyticsResponse = z.infer<
  typeof BlockAnalyticsResponseSchema
>;

/** 外部サービス検証結果 1 件。 */
export const ExternalValidationResultSchema = z.object({
  id: z.string(),
  response_id: z.string(),
  rule_id: z.string(),
  rule_name: z.string(),
  provider_name: z.string(),
  rule_type: z.string(),
  referenced_block_id: z.string(),
  referenced_block_label: z.string().nullable(),
  referenced_block_missing: z.boolean(),
  service: z.string(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "MISSING"]),
  success: z.boolean().nullable(),
  attempt_count: z.number().int(),
  last_attempt_at: z.string().optional(),
  next_retry_at: z.string().optional(),
  metadata: z.unknown(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  job_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ExternalValidationResult = z.infer<
  typeof ExternalValidationResultSchema
>;

/** GET /:id/responses/:responseId のレスポンス。 */
export const ResponseDetailRowSchema = FormResponseRowSchema.extend({
  uniquenessScore: z.number().min(0).max(1).nullable(),
});
export type ResponseDetailRow = z.infer<typeof ResponseDetailRowSchema>;

export const ResponseDetailResponseSchema = z.object({
  response: ResponseDetailRowSchema,
  externalValidations: z.array(ExternalValidationResultSchema),
});
export type ResponseDetailResponse = z.infer<
  typeof ResponseDetailResponseSchema
>;

/** POST /:id/responses/bulk-delete の 1 件結果。 */
export const BulkDeleteResultItemSchema = z.object({
  responseId: z.string(),
  status: z.enum(["deleted", "failed"]),
  error: z.string().optional(),
});

/** POST /:id/responses/bulk-delete のレスポンス。 */
export const BulkDeleteResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    deleted: z.number().int(),
    failed: z.number().int(),
    results: z.array(BulkDeleteResultItemSchema),
  }),
});
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

/** POST /:id/responses/validation/bulk-retry および /:responseId/validation/retry のレスポンス。 */
export const ValidationRetryResponseSchema = z.object({
  enqueued: z.number().int(),
  skipped: z.number().int(),
  jobIds: z.array(z.string()),
});
export type ValidationRetryResponse = z.infer<
  typeof ValidationRetryResponseSchema
>;

/** validation retry の enqueue 失敗レスポンス。 */
export const ValidationRetryEnqueueErrorResponseSchema = z.object({
  error: z.literal(
    "No validation jobs could be enqueued; check service configuration",
  ),
  enqueued: z.literal(0),
  skipped: z.number().int(),
  jobIds: z.array(z.string()),
});
export type ValidationRetryEnqueueErrorResponse = z.infer<
  typeof ValidationRetryEnqueueErrorResponseSchema
>;
