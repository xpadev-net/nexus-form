import { z } from "zod";
import { FormResponseRowSchema } from "./form-row";
import { isoDate } from "./iso-date";

/** GET /:id/responses のリストアイテム（responseDataJson を含まない）。 */
export const ResponseListItemSchema = z.object({
  id: z.string(),
  formId: z.string(),
  submittedAt: isoDate,
  updatedAt: isoDate.nullable(),
  respondentUuid: z.string(),
  userAgent: z.string().nullable(),
  sessionId: z.string().nullable(),
  countryCode: z.string().nullable(),
});
export type ResponseListItem = z.infer<typeof ResponseListItemSchema>;

/** GET /:id/responses のレスポンス。 */
export const ResponsesListResponseSchema = z.object({
  responses: z.array(ResponseListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type ResponsesListResponse = z.infer<typeof ResponsesListResponseSchema>;

/** POST /:id/responses / PUT /:id/responses/:responseId のレスポンス。 */
export const ResponseMutationResponseSchema = z.object({
  response: FormResponseRowSchema.nullable(),
});
export type ResponseMutationResponse = z.infer<
  typeof ResponseMutationResponseSchema
>;

/** GET /:id/responses/ids のレスポンス。 */
export const ResponseIdsResponseSchema = z.object({
  responseIds: z.array(z.string()),
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
      date: z.string(),
      count: z.number().int(),
    }),
  ),
});
export type ResponseAnalyticsResponse = z.infer<
  typeof ResponseAnalyticsResponseSchema
>;

/** GET /:id/responses/block-analytics の 1 ブロック。 */
export const BlockAnalyticsResultSchema = z.object({
  block_id: z.string(),
  block_type: z.string(),
  block_title: z.string(),
  total_responses: z.number().int(),
  response_rate: z.number(),
  analytics_data: z.unknown(),
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
export const ResponseDetailResponseSchema = z.object({
  response: FormResponseRowSchema,
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
  jobIds: z.array(z.string()),
});
export type ValidationRetryResponse = z.infer<
  typeof ValidationRetryResponseSchema
>;
