import { describe, expect, it } from "vitest";
import {
  buildRarityStats,
  buildResponseSuspicionGroups,
  canonicalizeFingerprintSignal,
  evaluateResponsePairLink,
  type ResponseLinkAnalysisResponse,
} from "../forms/response-link-model-v2";

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
});
