import { describe, expect, it } from "vitest";
import {
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
});
