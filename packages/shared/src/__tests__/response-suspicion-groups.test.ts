import { describe, expect, it } from "vitest";
import { RESPONSE_LINK_MODEL_VERSION } from "../forms/response-link-model-v2";
import {
  ResponseLinkAnalysisRecalculateResponseSchema,
  ResponseSuspicionGroupDetailResponseSchema,
  ResponseSuspicionGroupsResponseSchema,
} from "../forms/response-suspicion-groups";

const degradedRun = {
  id: "run-1",
  modelVersion: RESPONSE_LINK_MODEL_VERSION,
  statsVersion: "stats-1",
  populationSize: 123,
  completedAt: "2026-07-29T00:00:00.000Z",
  candidatePairLimitExceeded: true,
  skippedCandidateBucketCount: 2,
};

describe("response-suspicion-groups contract", () => {
  it("exposes degraded candidate-cap metadata on list responses", () => {
    expect(
      ResponseSuspicionGroupsResponseSchema.parse({
        run: degradedRun,
        groups: [],
        hasNext: false,
      }).run,
    ).toMatchObject({
      candidatePairLimitExceeded: true,
      skippedCandidateBucketCount: 2,
    });
  });

  it("exposes degraded candidate-cap metadata on detail responses", () => {
    expect(
      ResponseSuspicionGroupDetailResponseSchema.parse({
        run: degradedRun,
        group: null,
        members: [],
        links: [],
        hasNextMembers: false,
        hasNextLinks: false,
      }).run,
    ).toMatchObject({
      candidatePairLimitExceeded: true,
      skippedCandidateBucketCount: 2,
    });
  });

  it("exposes response-link recalculation enqueue status", () => {
    expect(
      ResponseLinkAnalysisRecalculateResponseSchema.parse({
        enqueued: false,
        status: "dirty",
      }),
    ).toEqual({ enqueued: false, status: "dirty" });
  });
});
