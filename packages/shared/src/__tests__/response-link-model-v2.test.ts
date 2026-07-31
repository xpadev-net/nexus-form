import { describe, expect, it } from "vitest";
import {
  buildRarityStats,
  buildResponseSuspicionGroups,
  canonicalizeFingerprintSignal,
  evaluateResponsePairLink,
  isAggregateOnlyLink,
  type ResponseLinkAnalysisResponse,
} from "../forms/response-link-model-v2";

/** Components spread across several families so a shared device image
 * produces enough combined evidence to approach the multiple-device-families
 * threshold, mirroring what a homogeneous population (e.g. a school computer
 * lab with an identical machine image) looks like in production. */
const DEVICE_IMAGE_COMPONENTS: Array<[string, string]> = [
  ["fingerprintjs", "fonts"],
  ["fingerprintjs", "canvas"],
  ["fingerprintjs", "webgl"],
  ["fingerprintjs", "webGlBasics"],
  ["fingerprintjs", "system"],
  ["fingerprintjs", "userAgentData"],
  ["fingerprintjs", "hardwareConcurrency"],
  ["fingerprintjs", "audio"],
  ["fingerprintjs", "screenResolution"],
];

function deviceImageResponse(
  id: string,
  sharesDeviceImage: boolean,
  options: { v6?: string } = {},
): ResponseLinkAnalysisResponse {
  return {
    id,
    sessionId: null,
    respondentUuid: `respondent-${id}`,
    userAgent: null,
    fingerprintDetails: [
      ...DEVICE_IMAGE_COMPONENTS.map(([fingerprintType, componentName]) => ({
        responseId: id,
        fingerprintType,
        componentName,
        componentValueHash: sharesDeviceImage
          ? `shared-${componentName}`
          : `unique-${componentName}-${id}`,
      })),
      ...(options.v6
        ? [
            {
              responseId: id,
              fingerprintType: "telemetry",
              componentName: "v6",
              componentValueHash: options.v6,
            },
          ]
        : []),
    ],
  };
}

function response(
  id: string,
  fingerprints: Array<
    Omit<
      ResponseLinkAnalysisResponse["fingerprintDetails"][number],
      "responseId"
    >
  >,
  options: Partial<ResponseLinkAnalysisResponse> = {},
): ResponseLinkAnalysisResponse {
  return {
    id,
    sessionId: options.sessionId ?? null,
    respondentUuid: options.respondentUuid ?? `respondent-${id}`,
    userAgent: options.userAgent ?? null,
    fingerprintDetails: fingerprints.map((fingerprint) => ({
      responseId: id,
      ...fingerprint,
    })),
  };
}

function evaluateFirstPair(responses: ResponseLinkAnalysisResponse[]) {
  const [left, right] = responses;
  if (!left || !right) {
    throw new Error("test fixture must contain at least two responses");
  }
  return evaluateResponsePairLink(left, right, buildRarityStats(responses));
}

describe("response-link-model-v2", () => {
  it("marks telemetry v6 matches as STRONG without using external validation", () => {
    const responses = [
      response("r1", [
        {
          fingerprintType: "telemetry",
          componentName: "v6",
          componentValueHash: "v6-a",
        },
      ]),
      response("r2", [
        {
          fingerprintType: "telemetry",
          componentName: "v6",
          componentValueHash: "v6-a",
        },
      ]),
    ];

    expect(evaluateFirstPair(responses)).toMatchObject({
      strength: "STRONG",
      v6Strong: true,
      reasonCodes: ["strong:telemetry:v6"],
    });
  });

  it("excludes collector error values from device evidence", () => {
    const signal = canonicalizeFingerprintSignal({
      responseId: "r1",
      fingerprintType: "fingerprintjs",
      componentName: "canvas",
      componentValue: "error: blocked",
      componentValueHash: "rare-error",
    });

    expect(signal.quality).toBe("error");

    const responses = [
      response("r1", [
        {
          fingerprintType: "fingerprintjs",
          componentName: "canvas",
          componentValue: "error: blocked",
          componentValueHash: "rare-error",
        },
      ]),
      response("r2", [
        {
          fingerprintType: "fingerprintjs",
          componentName: "canvas",
          componentValue: "error: blocked",
          componentValueHash: "rare-error",
        },
      ]),
    ];

    expect(evaluateFirstPair(responses)).toMatchObject({
      strength: "NONE",
      deviceEvidence: 0,
    });
  });

  it("keeps SUPPORT-only links out of suspicion groups", () => {
    const responses = [
      response("r1", [
        {
          fingerprintType: "fingerprintjs",
          componentName: "visitorId",
          componentValueHash: "visitor-a",
        },
      ]),
      response("r2", [
        {
          fingerprintType: "fingerprintjs",
          componentName: "visitorId",
          componentValueHash: "visitor-a",
        },
      ]),
    ];
    const link = evaluateFirstPair(responses);

    expect(link.strength).toBe("SUPPORT");
    expect(buildResponseSuspicionGroups([link])).toEqual([]);
  });

  it("raises the multiple-device-families bar when a subset of the population shares an identical device image", () => {
    const populationSize = 40;
    const sharedClusterSize = 8;
    const responses: ResponseLinkAnalysisResponse[] = [];
    for (let i = 0; i < populationSize; i += 1) {
      responses.push(deviceImageResponse(`r${i}`, i < sharedClusterSize));
    }
    const stats = buildRarityStats(responses);
    expect(stats.populationDiversityFactor).toBeLessThan(1);

    const clusterMembers = responses.slice(0, sharedClusterSize);
    const links = [];
    for (let i = 0; i < clusterMembers.length; i += 1) {
      for (let j = i + 1; j < clusterMembers.length; j += 1) {
        const a = clusterMembers[i];
        const b = clusterMembers[j];
        if (!a || !b) continue;
        links.push(evaluateResponsePairLink(a, b, stats));
      }
    }

    // Identical device signals still generate evidence, but not enough on
    // their own to declare these unrelated respondents STRONG-linked.
    expect(links.every((link) => link.strength !== "STRONG")).toBe(true);
    expect(buildResponseSuspicionGroups(links)).toEqual([]);
  });

  it("does not let a coincidentally-similar device profile drag an unrelated response into a confirmed group", () => {
    const populationSize = 40;
    const responses: ResponseLinkAnalysisResponse[] = [
      deviceImageResponse("A", true, { v6: "v6-shared" }),
      deviceImageResponse("B", true, { v6: "v6-shared" }),
      deviceImageResponse("C", true),
    ];
    for (let i = 3; i < populationSize; i += 1) {
      responses.push(deviceImageResponse(`r${i}`, false));
    }
    const stats = buildRarityStats(responses);

    const [a, b, c] = responses;
    if (!a || !b || !c) throw new Error("test fixture missing responses");
    const linkAB = evaluateResponsePairLink(a, b, stats);
    const linkAC = evaluateResponsePairLink(a, c, stats);
    const linkBC = evaluateResponsePairLink(b, c, stats);

    expect(linkAB.reasonCodes).toContain("strong:telemetry:v6");
    expect(isAggregateOnlyLink(linkAB)).toBe(false);
    expect(isAggregateOnlyLink(linkAC)).toBe(true);
    expect(isAggregateOnlyLink(linkBC)).toBe(true);

    const groups = buildResponseSuspicionGroups([linkAB, linkAC, linkBC]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      responseIds: ["A", "B"],
      technicalConfidence: "STRONG",
    });
  });
});
