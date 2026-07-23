import { describe, expect, it } from "vitest";
import {
  calculatePairwiseMatchedWeight,
  calculateUniqueness,
  calculateUniquenessScoreMap,
  normalizeMatchedWeightToUniqueness,
  type ResponseWithFingerprints,
} from "../forms/uniqueness-calculator";

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

    const score1 = calculateUniqueness(r1, [r1, r2]);
    const score2 = calculateUniqueness(r2, [r1, r2]);

    expect(score1).toBe(0.0);
    expect(score2).toBe(0.0);
  });

  it("returns 0.0 immediately if target response shares a v6 telemetry token with another response", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: "session-1",
      fingerprintDetails: [
        {
          componentName: "v6",
          componentValueHash: "ipv6-hash-xyz",
          fingerprintType: "telemetry",
        },
      ],
    };
    const r2: ResponseWithFingerprints = {
      id: "res-2",
      sessionId: "session-2",
      fingerprintDetails: [
        {
          componentName: "v6",
          componentValueHash: "ipv6-hash-xyz",
          fingerprintType: "telemetry",
        },
      ],
    };

    expect(calculateUniqueness(r1, [r1, r2])).toBe(0.0);
    expect(calculateUniqueness(r2, [r1, r2])).toBe(0.0);
  });

  it("handles whitespace-padded sessionIds correctly when checking matches", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: " session-abc ",
      fingerprintDetails: [],
    };
    const r2: ResponseWithFingerprints = {
      id: "res-2",
      sessionId: "session-abc",
      fingerprintDetails: [],
    };

    expect(calculateUniqueness(r1, [r1, r2])).toBe(0.0);
  });

  it("skips 0.0 shortcut when sessionId is null, undefined, empty, or whitespace-only", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: null,
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
      sessionId: "  ",
      fingerprintDetails: [
        {
          componentName: "fonts",
          componentValueHash: "hash-2",
          fingerprintType: "browser",
        },
      ],
    };

    // Both fail the non-empty sessionId check, so falls back to fingerprint calculation (1.0 since hashes differ)
    expect(calculateUniqueness(r1, [r1, r2])).toBe(1.0);
    expect(calculateUniqueness(r2, [r1, r2])).toBe(1.0);
  });

  it("returns 1.0 when there is only one response in total or in others", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: "session-abc",
      fingerprintDetails: [],
    };

    expect(calculateUniqueness(r1, [r1])).toBe(1.0);
  });

  it("returns 0.0 when sessionIds match even if fingerprintDetails is empty", () => {
    const r1: ResponseWithFingerprints = {
      id: "res-1",
      sessionId: "session-xyz",
      fingerprintDetails: [],
    };
    const r2: ResponseWithFingerprints = {
      id: "res-2",
      sessionId: "session-xyz",
      fingerprintDetails: [],
    };

    expect(calculateUniqueness(r1, [r1, r2])).toBe(0.0);
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
        sessionId: "session-1",
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
        sessionId: "session-2",
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

  describe("calculatePairwiseMatchedWeight", () => {
    it("returns 0 if either response has empty fingerprintDetails", () => {
      const r1: ResponseWithFingerprints = { id: "1", fingerprintDetails: [] };
      const r2: ResponseWithFingerprints = {
        id: "2",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "h1",
            fingerprintType: "browser",
          },
        ],
      };
      expect(calculatePairwiseMatchedWeight(r1, r2)).toBe(0);
      expect(calculatePairwiseMatchedWeight(r2, r1)).toBe(0);
    });

    it("calculates matched weights correctly for browser components", () => {
      const r1: ResponseWithFingerprints = {
        id: "1",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "same-fonts",
            fingerprintType: "browser",
          },
          {
            componentName: "screen",
            componentValueHash: "same-screen",
            fingerprintType: "browser",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "2",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "same-fonts",
            fingerprintType: "browser",
          },
          {
            componentName: "screen",
            componentValueHash: "different-screen",
            fingerprintType: "browser",
          },
        ],
      };

      // fonts weight is 1.0 (from COMPONENT_WEIGHTS)
      expect(calculatePairwiseMatchedWeight(r1, r2)).toBe(1.0);
    });

    it("applies dynamic IP weights correctly for dual-stack vs single-stack", () => {
      // Single-stack v4 match = 1.5
      const rSingle1: ResponseWithFingerprints = {
        id: "s1",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
        ],
      };
      const rSingle2: ResponseWithFingerprints = {
        id: "s2",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
        ],
      };
      expect(calculatePairwiseMatchedWeight(rSingle1, rSingle2)).toBe(1.5);

      // Dual-stack v4 + v6 match = 2.0
      const rDual1: ResponseWithFingerprints = {
        id: "d1",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
          {
            componentName: "v6",
            componentValueHash: "v6-same",
            fingerprintType: "telemetry",
          },
        ],
      };
      const rDual2: ResponseWithFingerprints = {
        id: "d2",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
          {
            componentName: "v6",
            componentValueHash: "v6-same",
            fingerprintType: "telemetry",
          },
        ],
      };
      expect(calculatePairwiseMatchedWeight(rDual1, rDual2)).toBe(2.0);
    });
  });

  describe("normalizeMatchedWeightToUniqueness", () => {
    it("returns 1.0 for matchedWeight <= 0", () => {
      expect(normalizeMatchedWeightToUniqueness(0)).toBe(1.0);
      expect(normalizeMatchedWeightToUniqueness(-1)).toBe(1.0);
    });

    it("calibrates values according to JSDoc thresholds", () => {
      // W = 1.4 (natural noise threshold for distinct users) -> ~0.9577
      const score1_4 = normalizeMatchedWeightToUniqueness(1.4);
      expect(score1_4).toBeGreaterThanOrEqual(0.9);
      expect(score1_4).toBeLessThanOrEqual(1.0);

      // W = 4.0 (midpoint) -> ~0.5250
      const score4_0 = normalizeMatchedWeightToUniqueness(4.0);
      expect(score4_0).toBeCloseTo(0.525, 2);

      // W = 7.0 (heavy overlap / duplicate) -> ~0.0661
      const score7_0 = normalizeMatchedWeightToUniqueness(7.0);
      expect(score7_0).toBeLessThan(0.1);

      // W = 12.0 (near identical) -> ~0.0002 -> clamped low
      const score12_0 = normalizeMatchedWeightToUniqueness(12.0);
      expect(score12_0).toBeLessThan(0.01);
    });
  });
});
