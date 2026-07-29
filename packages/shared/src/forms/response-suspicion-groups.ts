import { z } from "zod";
import { RESPONSE_LINK_MODEL_VERSION } from "./response-link-model-v2";

/**
 * Technical confidence assigned to a response pair or suspicion group.
 * HARD is reserved for same-session style technical identity, STRONG for
 * high-confidence device/network evidence such as v6 or independent device
 * families, SUPPORT for review-only hints, and NONE is not exposed as a link.
 */
export const ResponseLinkStrengthSchema = z.enum([
  "NONE",
  "SUPPORT",
  "STRONG",
  "HARD",
]);

/**
 * Per-family contribution shown in the UI. Scores are capped by the
 * response-link model family rules and reasonCodes describe matched canonical
 * signals without exposing raw hashes.
 */
export const FamilyContributionSchema = z.object({
  family: z.string(),
  score: z.number(),
  reasonCodes: z.array(z.string()),
});

/**
 * Summary row for one connected suspicion group in a completed analysis run.
 * groupKey is a deterministic key derived from the sorted response ids in that
 * group and is only stable inside the same run. technicalConfidence is the
 * strongest technical link observed inside the group; it is not an abuse
 * decision and does not use external validation results.
 */
export const ResponseSuspicionGroupListItemSchema = z.object({
  groupKey: z.string(),
  technicalConfidence: ResponseLinkStrengthSchema,
  responseCount: z.number().int(),
  strongLinkCount: z.number().int(),
  supportLinkCount: z.number().int(),
  reasonCodes: z.array(z.string()),
  topFamilies: z.array(FamilyContributionSchema),
});
export type ResponseSuspicionGroupListItem = z.infer<
  typeof ResponseSuspicionGroupListItemSchema
>;

/**
 * Paginated list response for the latest completed response-link shadow run.
 * groups contains at most the API page size, and hasNext indicates that more
 * groups exist in persisted analysis data.
 */
export const ResponseSuspicionGroupsResponseSchema = z.object({
  run: z
    .object({
      id: z.string(),
      modelVersion: z.literal(RESPONSE_LINK_MODEL_VERSION),
      statsVersion: z.string().nullable(),
      populationSize: z.number().int(),
      completedAt: z.string().nullable(),
    })
    .nullable(),
  groups: z.array(ResponseSuspicionGroupListItemSchema),
  hasNext: z.boolean(),
});
export type ResponseSuspicionGroupsResponse = z.infer<
  typeof ResponseSuspicionGroupsResponseSchema
>;

/**
 * Detail response for a single suspicion group. members and links are scoped
 * to the requested groupKey; links never include pairs outside that group even
 * when the run contains other linked responses.
 */
export const ResponseSuspicionGroupDetailResponseSchema = z.object({
  run: ResponseSuspicionGroupsResponseSchema.shape.run,
  group: ResponseSuspicionGroupListItemSchema.nullable(),
  members: z.array(
    z.object({
      responseId: z.string(),
      submittedAt: z.string(),
      respondentUuid: z.string(),
      strongestStrength: ResponseLinkStrengthSchema,
      strongestEvidence: z.number(),
    }),
  ),
  links: z.array(
    z.object({
      responseIdA: z.string(),
      responseIdB: z.string(),
      strength: ResponseLinkStrengthSchema,
      deviceEvidence: z.number(),
      v4Support: z.boolean(),
      v6Strong: z.boolean(),
      stateSupport: z.boolean(),
      reasonCodes: z.array(z.string()),
      familyContributions: z.array(FamilyContributionSchema),
    }),
  ),
  hasNextMembers: z.boolean(),
  hasNextLinks: z.boolean(),
});
export type ResponseSuspicionGroupDetailResponse = z.infer<
  typeof ResponseSuspicionGroupDetailResponseSchema
>;

/**
 * Response returned when a recalculation request is accepted or coalesced.
 * enqueued=false means an equivalent analysis job is already pending or active.
 */
export const ResponseLinkAnalysisRecalculateResponseSchema = z.object({
  enqueued: z.boolean(),
});
export type ResponseLinkAnalysisRecalculateResponse = z.infer<
  typeof ResponseLinkAnalysisRecalculateResponseSchema
>;
