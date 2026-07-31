import { describe, expect, it } from "vitest";
import { RESPONSE_LINK_MODEL_VERSION } from "../forms/response-link-model-v2";
import {
  ResponseLinkAnalysisRecalculateResponseSchema,
  ResponseRelationGraphResponseSchema,
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

  it("exposes relation graph links with hover evidence but no raw hashes", () => {
    expect(
      ResponseRelationGraphResponseSchema.parse({
        run: degradedRun,
        nodes: [
          {
            responseId: "response-a",
            submittedAt: "2026-07-30T00:00:00.000Z",
            respondentUuid: "respondent-a",
            strongestStrength: "STRONG",
            strongestEvidence: 1.25,
            contentHash: "content-hash-a",
          },
        ],
        edges: [
          {
            responseIdA: "response-a",
            responseIdB: "response-b",
            strength: "STRONG",
            deviceEvidence: 1.25,
            v4Support: false,
            v6Strong: true,
            stateSupport: false,
            reasonCodes: ["strong:telemetry:v6"],
            familyContributions: [
              {
                family: "composite",
                score: 1.25,
                reasonCodes: ["match:fingerprintjs:visitorId"],
              },
            ],
          },
        ],
        denseClusters: [
          {
            id: "cluster-1",
            responseIds: ["response-a", "response-b"],
            strength: "SUPPORT",
            reasonCode: "support:visitorId",
            pairCount: 1,
          },
        ],
        hasNextNodes: false,
        hasNextEdges: false,
      }),
    ).toMatchObject({
      edges: [{ reasonCodes: ["strong:telemetry:v6"] }],
      denseClusters: [{ strength: "SUPPORT" }],
    });
  });
});
