import { z } from "zod";
import { RESPONSE_LINK_MODEL_VERSION } from "./response-link-model-v2";

export const ResponseLinkStrengthSchema = z.enum([
  "NONE",
  "SUPPORT",
  "STRONG",
  "HARD",
]);

export const FamilyContributionSchema = z.object({
  family: z.string(),
  score: z.number(),
  reasonCodes: z.array(z.string()),
});

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

export const ResponseLinkAnalysisRecalculateResponseSchema = z.object({
  enqueued: z.boolean(),
});
export type ResponseLinkAnalysisRecalculateResponse = z.infer<
  typeof ResponseLinkAnalysisRecalculateResponseSchema
>;
