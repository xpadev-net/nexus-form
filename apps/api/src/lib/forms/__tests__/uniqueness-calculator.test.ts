import { describe, expect, it } from "vitest";
import {
  calculateUniqueness,
  calculateUniquenessScoreMap,
  type ResponseWithFingerprints,
} from "../uniqueness-calculator";

describe("uniqueness-calculator", () => {
  it("returns 0.0 immediately if target response shares a sessionId with another response", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: "session-abc",
      fingerprintDetails: [
        {
          componentName: "fonts",
          componentValueHash: "hash-1",
          fingerprintType: "browser",
        },
      ],
    };
    const r2: ResponseWithFingerprints = {
      id: "res-2",
      sessionId: "session-abc",
      fingerprintDetails: [
        {
          componentName: "fonts",
          componentValueHash: "hash-completely-different",
          fingerprintType: "browser",
        },
      ],
    };

    // Fingerprints are completely different, but since sessionIds match, score is 0.0
    const score1 = calculateUniqueness(r1, [r1, r2]);
    const score2 = calculateUniqueness(r2, [r1, r2]);

    expect(score1).toBe(0.0);
    expect(score2).toBe(0.0);
  });

  it("calculates uniqueness based on fingerprintDetails when sessionIds do not match", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: "session-abc",
      fingerprintDetails: [
        {
          componentName: "fonts",
          componentValueHash: "hash-1",
          fingerprintType: "browser",
        },
      ],
    };
    const r2: ResponseWithFingerprints = {
      id: "res-2",
      sessionId: "session-xyz",
      fingerprintDetails: [
        {
          componentName: "fonts",
          componentValueHash: "hash-2",
          fingerprintType: "browser",
        },
      ],
    };

    const score1 = calculateUniqueness(r1, [r1, r2]);
    const score2 = calculateUniqueness(r2, [r1, r2]);

    // Fingerprints differ and sessionIds differ, so score is 1.0 (completely unique)
    expect(score1).toBe(1.0);
    expect(score2).toBe(1.0);
  });

  it("calculates uniqueness score map correctly with mixed sessionIds", () => {
    const responses: ResponseWithFingerprints[] = [
      {
        id: "res-1",
        sessionId: "session-1",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "hash-a",
            fingerprintType: "browser",
          },
        ],
      },
      {
        id: "res-2",
        sessionId: "session-1", // same session as res-1
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "hash-b",
            fingerprintType: "browser",
          },
        ],
      },
      {
        id: "res-3",
        sessionId: "session-2", // different session
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "hash-c",
            fingerprintType: "browser",
          },
        ],
      },
    ];

    const scoreMap = calculateUniquenessScoreMap(responses);

    expect(scoreMap.get("res-1")).toBe(0.0);
    expect(scoreMap.get("res-2")).toBe(0.0);
    expect(scoreMap.get("res-3")).toBe(1.0);
  });
});
