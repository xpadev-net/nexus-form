import { describe, expect, it } from "vitest";
import {
  calculatePairwiseMatchedWeight,
  calculateUniqueness,
  calculateUniquenessScoreMap,
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
    it("returns 0 matchedWeight if either response has empty fingerprintDetails", () => {
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
      expect(calculatePairwiseMatchedWeight(r1, r2).matchedWeight).toBe(0);
      expect(calculatePairwiseMatchedWeight(r2, r1).matchedWeight).toBe(0);
    });

    it("calculates matched weights correctly and deduplicates across providers", () => {
      const r1: ResponseWithFingerprints = {
        id: "1",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "same-fonts",
            fingerprintType: "fingerprintjs",
          },
          {
            componentName: "fonts",
            componentValueHash: "same-fonts",
            fingerprintType: "thumbmarkjs",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "2",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "same-fonts",
            fingerprintType: "fingerprintjs",
          },
        ],
      };

      const res = calculatePairwiseMatchedWeight(r1, r2);
      expect(res.matchedWeight).toBe(1.0);
    });

    it("detects v4 and v6 matches correctly", () => {
      const r1: ResponseWithFingerprints = {
        id: "1",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-hash",
            fingerprintType: "telemetry",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "2",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-hash",
            fingerprintType: "telemetry",
          },
        ],
      };

      const res = calculatePairwiseMatchedWeight(r1, r2);
      expect(res.v4Match).toBe(true);
      expect(res.v6Match).toBe(false);
    });
  });
});
