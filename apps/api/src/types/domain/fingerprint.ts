import { z } from "zod";
import { isoDate } from "./iso-date";

/** POST /fingerprint/save のレスポンス。 */
export const FingerprintSaveResponseSchema = z.object({
  saved: z.number().int(),
});
export type FingerprintSaveResponse = z.infer<
  typeof FingerprintSaveResponseSchema
>;

/** GET /fingerprint/get が返す 1 行。 */
export const FingerprintGetRowSchema = z.object({
  id: z.string(),
  responseId: z.string(),
  fingerprintType: z.string(),
  componentName: z.string(),
  componentValueHash: z.string(),
  confidence: z.number().nullable(),
  collectedAt: isoDate,
});

/** GET /fingerprint/get のレスポンス。 */
export const FingerprintGetResponseSchema = z.object({
  fingerprints: z.array(FingerprintGetRowSchema),
});
export type FingerprintGetResponse = z.infer<
  typeof FingerprintGetResponseSchema
>;

/** 匿名化フィンガープリント 1 件。 */
export const AnonymizedFingerprintSchema = z.object({
  id: z.string(),
  responseId: z.string(),
  fingerprintType: z.string(),
  anonymizedId: z.string(),
  isDuplicate: z.boolean(),
  duplicateCount: z.number().int(),
  collectedAt: isoDate,
  response: z.object({
    id: z.string(),
    formId: z.string(),
    submittedAt: isoDate,
    respondentUuid: z.string(),
  }),
});

/** 匿名化フィンガープリントの統計。 */
export const AnonymizedFingerprintStatsSchema = z.object({
  totalFingerprints: z.number().int(),
  uniqueFingerprints: z.number().int(),
  duplicateFingerprints: z.number().int(),
  duplicateRate: z.number(),
  fingerprintTypes: z.array(
    z.object({
      type: z.string(),
      count: z.number().int(),
      uniqueCount: z.number().int(),
      duplicateCount: z.number().int(),
    }),
  ),
});

/** GET /fingerprint/anonymized のレスポンス。 */
export const AnonymizedFingerprintsResponseSchema = z.object({
  fingerprints: z.array(AnonymizedFingerprintSchema),
  stats: AnonymizedFingerprintStatsSchema.optional(),
});
export type AnonymizedFingerprintsResponse = z.infer<
  typeof AnonymizedFingerprintsResponseSchema
>;

/** GET /fingerprint/manage が返す 1 行。 */
export const FingerprintManageRowSchema = z.object({
  id: z.string(),
  responseId: z.string(),
  fingerprintType: z.string(),
  componentName: z.string(),
  componentValueHash: z.string(),
  collectedAt: isoDate,
  expiresAt: isoDate.nullable(),
});

/** GET /fingerprint/manage のレスポンス。 */
export const FingerprintManageResponseSchema = z.object({
  fingerprints: z.array(FingerprintManageRowSchema),
  total: z.number().int(),
});
export type FingerprintManageResponse = z.infer<
  typeof FingerprintManageResponseSchema
>;

/** DELETE /fingerprint/manage のレスポンス。 */
export const FingerprintDeleteResponseSchema = z.object({
  deleted: z.number().int(),
});
export type FingerprintDeleteResponse = z.infer<
  typeof FingerprintDeleteResponseSchema
>;

/** データ保持設定。 */
export const DataRetentionConfigSchema = z.object({
  fingerprintDetailRetentionDays: z.number().int(),
  responseRetentionDays: z.number().int().optional(),
  autoCleanupEnabled: z.boolean(),
  cleanupSchedule: z.string(),
});

/** データ保持の統計。 */
export const DataRetentionStatsSchema = z.object({
  totalFingerprintDetails: z.number().int(),
  expiredFingerprintDetails: z.number().int(),
  totalResponses: z.number().int(),
  expiredResponses: z.number().int(),
  lastCleanupDate: isoDate.nullable(),
  nextCleanupDate: isoDate.nullable(),
});

/** クリーンアップ結果。 */
export const CleanupResultSchema = z.object({
  deletedFingerprintDetails: z.number().int(),
  deletedResponses: z.number().int(),
  totalDeleted: z.number().int(),
  errors: z.array(z.string()),
  cleanupDate: isoDate,
});

/** GET /fingerprint/retention のレスポンス。 */
export const RetentionGetResponseSchema = z.object({
  config: DataRetentionConfigSchema,
  stats: DataRetentionStatsSchema,
});
export type RetentionGetResponse = z.infer<typeof RetentionGetResponseSchema>;

/** POST /fingerprint/retention のレスポンス。 */
export const RetentionUpdateResponseSchema = z.object({
  config: DataRetentionConfigSchema,
});
export type RetentionUpdateResponse = z.infer<
  typeof RetentionUpdateResponseSchema
>;

/** PUT /fingerprint/retention のレスポンス。 */
export const RetentionCleanupResponseSchema = z.object({
  result: CleanupResultSchema,
});
export type RetentionCleanupResponse = z.infer<
  typeof RetentionCleanupResponseSchema
>;
