import { describe, expect, it } from "vitest";
import {
  buildComponentMap,
  calculateAllUniquenessScores,
  calculatePairwiseMatchedWeight,
  calculateUniqueness,
  calculateUniquenessScoreMap,
  getUniquenessScoreRating,
  hasSetIntersection,
  type ResponseWithFingerprints,
} from "../forms/uniqueness-calculator";

describe("uniqueness-calculator", () => {
  describe("getUniquenessScoreRating helper", () => {
    it("returns correct 3-tier rating labels", () => {
      expect(getUniquenessScoreRating(1.0)).toBe("高");
      expect(getUniquenessScoreRating(0.8)).toBe("高");
      expect(getUniquenessScoreRating(0.7999)).toBe("中");
      expect(getUniquenessScoreRating(0.5)).toBe("中");
      expect(getUniquenessScoreRating(0.4999)).toBe("低");
      expect(getUniquenessScoreRating(0.0)).toBe("低");
      expect(getUniquenessScoreRating(undefined)).toBe("");
      expect(getUniquenessScoreRating(null)).toBe("");
      expect(getUniquenessScoreRating(NaN)).toBe("");
    });
  });
  describe("hasSetIntersection helper", () => {
    it("returns false for undefined or empty sets", () => {
      expect(hasSetIntersection(undefined, new Set(["a"]))).toBe(false);
      expect(hasSetIntersection(new Set(["a"]), undefined)).toBe(false);
      expect(hasSetIntersection(new Set(), new Set(["a"]))).toBe(false);
    });

    it("detects shared items correctly", () => {
      expect(hasSetIntersection(new Set(["a", "b"]), new Set(["b", "c"]))).toBe(
        true,
      );
      expect(hasSetIntersection(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(
        false,
      );
    });
  });

  describe("buildComponentMap helper", () => {
    it("builds a component map with sets of value hashes", () => {
      const response: ResponseWithFingerprints = {
        id: "r1",
        fingerprintDetails: [
          {
            componentName: "fonts",
            componentValueHash: "h1",
            fingerprintType: "fp",
          },
          {
            componentName: "fonts",
            componentValueHash: "h2",
            fingerprintType: "tm",
          },
          {
            componentName: "canvas",
            componentValueHash: "h3",
            fingerprintType: "fp",
          },
        ],
      };
      const map = buildComponentMap(response);
      expect(map.get("fonts")).toEqual(new Set(["h1", "h2"]));
      expect(map.get("canvas")).toEqual(new Set(["h3"]));
    });
  });

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

    it("applies dynamic IP weights correctly for dual-stack vs single-stack", () => {
      // Single-stack v4 match = 2.2
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
      expect(
        calculatePairwiseMatchedWeight(rSingle1, rSingle2).ipMatchedWeight,
      ).toBe(2.2);

      // Dual-stack v4 + v6 match = 3.0
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
      expect(
        calculatePairwiseMatchedWeight(rDual1, rDual2).ipMatchedWeight,
      ).toBe(3.0);

      // Dual-stack v4 only match (v6 differs/unmatched) = 1.0
      const rDualPartial: ResponseWithFingerprints = {
        id: "d3",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
          {
            componentName: "v6",
            componentValueHash: "v6-diff",
            fingerprintType: "telemetry",
          },
        ],
      };
      expect(
        calculatePairwiseMatchedWeight(rDual1, rDualPartial).ipMatchedWeight,
      ).toBe(1.0);

      // Dual-stack v6 only match (v4 differs/unmatched) = 1.0
      const rDualV6Only: ResponseWithFingerprints = {
        id: "d4",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-diff",
            fingerprintType: "telemetry",
          },
          {
            componentName: "v6",
            componentValueHash: "v6-same",
            fingerprintType: "telemetry",
          },
        ],
      };
      expect(
        calculatePairwiseMatchedWeight(rDual1, rDualV6Only).ipMatchedWeight,
      ).toBe(1.0);
    });

    it("treats pair as dual-stack when only one side has both v4+v6 (asymmetric case)", () => {
      // isDualStack の非対称仕様: 片方がデュアルスタックなら両者をデュアル扱い。
      // r1 がデュアルスタック(v4+v6 保持)、r2 がシングルスタック(v4 のみ)で v4 のみ一致する場合、
      // ipMatchedWeight は 1.0（デュアル扱い）になる。
      // これは「どちらがデュアルスタック環境か不明な場合の安全側フォールバック」による設計上の意図。
      const rDualFull: ResponseWithFingerprints = {
        id: "asym-dual",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
          {
            componentName: "v6",
            componentValueHash: "v6-only-in-dual",
            fingerprintType: "telemetry",
          },
        ],
      };
      const rSingleOnly: ResponseWithFingerprints = {
        id: "asym-single",
        fingerprintDetails: [
          {
            componentName: "v4",
            componentValueHash: "v4-same",
            fingerprintType: "telemetry",
          },
        ],
      };
      // r1 がデュアルスタック → isDualStack=true → v4 のみ一致 → ipMatchedWeight=1.0
      expect(
        calculatePairwiseMatchedWeight(rDualFull, rSingleOnly).ipMatchedWeight,
      ).toBe(1.0);
    });
  });

  describe("calculateUniqueness score bands", () => {
    /**
     * スコア帯域の境界値テスト用ヘルパー:
     * canvas のみ一致する2件のレスポンスを作成し、IP 重みは 0 にする。
     * canvas 重み 1.2 を起点に、必要な matchedWeight になるよう
     * 既知の重みのコンポーネントを組み合わせる。
     */
    function makeResponsePair(matchedComponents: string[]): {
      r1: ResponseWithFingerprints;
      r2: ResponseWithFingerprints;
    } {
      const details = matchedComponents.map((name) => ({
        componentName: name,
        componentValueHash: `hash-${name}`,
        fingerprintType: "browser",
      }));
      return {
        r1: { id: "band-r1", fingerprintDetails: details },
        r2: { id: "band-r2", fingerprintDetails: details },
      };
    }

    it("score is 1.0 when maxMatchedWeight=0 (no matching components)", () => {
      const r1: ResponseWithFingerprints = {
        id: "r1",
        fingerprintDetails: [
          {
            componentName: "canvas",
            componentValueHash: "hash-a",
            fingerprintType: "browser",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "r2",
        fingerprintDetails: [
          {
            componentName: "canvas",
            componentValueHash: "hash-b",
            fingerprintType: "browser",
          },
        ],
      };
      expect(calculateUniqueness(r1, [r1, r2])).toBe(1.0);
    });

    it("score at maxMatchedWeight=3.0 boundary is 0.9", () => {
      // canvas(1.2) + fonts(1.0) + screen(0.4) + hardwareConcurrency(0.2) + screenResolution(0.2) = 3.0
      const { r1, r2 } = makeResponsePair([
        "canvas",
        "fonts",
        "screen",
        "hardwareConcurrency",
        "screenResolution",
      ]);
      expect(calculateUniqueness(r1, [r1, r2])).toBe(0.9);
    });

    it("score at maxMatchedWeight=5.5 boundary is 0.65", () => {
      // v4 シングル(2.2) + canvas(1.2) + fonts(1.0) + webrtc(0.3) + screen(0.4)
      // + screenResolution(0.2) + hardwareConcurrency(0.2) = 5.5
      const matchedComponents = [
        "canvas",
        "fonts",
        "screen",
        "webrtc",
        "screenResolution",
        "hardwareConcurrency",
      ];
      const commonDetails = matchedComponents.map((name) => ({
        componentName: name,
        componentValueHash: `hash-${name}`,
        fingerprintType: "browser",
      }));
      const v4Detail = {
        componentName: "v4",
        componentValueHash: "v4-same",
        fingerprintType: "telemetry",
      };
      const r1: ResponseWithFingerprints = {
        id: "band-55-r1",
        fingerprintDetails: [...commonDetails, v4Detail],
      };
      const r2: ResponseWithFingerprints = {
        id: "band-55-r2",
        fingerprintDetails: [...commonDetails, v4Detail],
      };
      expect(calculateUniqueness(r1, [r1, r2])).toBe(0.65);
    });

    it("score is approximately 0.2 in low band near maxMatchedWeight=8.0 (matchedWeight≈7.99 → 0.2018)", () => {
      // matchedWeight ≈ 7.99 での低帯域 (5.5〜8.0) スコア計算を検証する。
      // v4 シングル(2.2) + 全既知コンポーネント合計(4.97) + 未知コンポーネント × 41(0.82)
      // = 2.2 + 4.97 + 0.82 = 7.99
      // score = 0.65 - ((7.99 - 5.5) / 2.5) * 0.45 = 0.65 - (2.49/2.5)*0.45 ≈ 0.2018
      // 参考: 厳密な 8.0 境界では 0.65 - (2.5/2.5)*0.45 = 0.20 となる
      const knownComponents = [
        "canvas",
        "fonts",
        "system",
        "screen",
        "webrtc",
        "webgl",
        "audio",
        "screenFrame",
        "hardwareConcurrency",
        "screenResolution",
        "userAgent",
        "userAgentData",
        "speech",
        "hardware",
        "deviceMemory",
        "audioBaseLatency",
        "platform",
        "languages",
        "locales",
        "vendorFlavors",
        "dateTimeLocale",
        "colorDepth",
        "domBlockers",
        "reducedTransparency",
      ];
      const unknownComponents = Array.from(
        { length: 41 },
        (_, i) => `unk80-${i}`,
      );
      const allComponents = [...knownComponents, ...unknownComponents];
      const commonDetails = allComponents.map((name) => ({
        componentName: name,
        componentValueHash: `hash-${name}`,
        fingerprintType: "browser",
      }));
      const v4Detail = {
        componentName: "v4",
        componentValueHash: "v4-same",
        fingerprintType: "telemetry",
      };
      const r1: ResponseWithFingerprints = {
        id: "band-80-r1",
        fingerprintDetails: [...commonDetails, v4Detail],
      };
      const r2: ResponseWithFingerprints = {
        id: "band-80-r2",
        fingerprintDetails: [...commonDetails, v4Detail],
      };
      expect(calculateUniqueness(r1, [r1, r2])).toBe(0.2018);
    });

    it("score clamps to 0.0 when maxMatchedWeight is very large", () => {
      // matchedWeight >= 10.0 で Math.max(0.0, ...) が 0.0 になることを確認
      // v4 シングルスタック(2.2) + 既知コンポーネント合計(≈4.97) + 未知コンポーネント × 142(≈2.84)
      // 合計 ≈ 10.01 >= 10.0 → score = 0.0 にクランプされる
      // ※ デュアルスタック v6 は step2 の一発アウトが先に発動するため使わない
      const knownComponents = [
        "canvas", // 1.2
        "fonts", // 1.0
        "system", // 0.5
        "screen", // 0.4
        "webrtc", // 0.3
        "webgl", // 0.25
        "audio", // 0.25
        "screenFrame", // 0.25
        "hardwareConcurrency", // 0.2
        "screenResolution", // 0.2
        "userAgent", // 0.05
        "userAgentData", // 0.05
        "speech", // 0.03
        "hardware", // 0.03
        "deviceMemory", // 0.03
        "audioBaseLatency", // 0.03
        "platform", // 0.03
        "languages", // 0.03
        "locales", // 0.03
        "vendorFlavors", // 0.03
        "dateTimeLocale", // 0.02
        "colorDepth", // 0.02
        "domBlockers", // 0.02
        "reducedTransparency", // 0.02
      ];
      // 既知合計 ≈ 4.97, v4 シングル = 2.2 → 合計 ≈ 7.17
      // 未知コンポーネント (DEFAULT_COMPONENT_WEIGHT=0.02 each) を 142 個追加
      // → 7.17 + 142*0.02 = 7.17 + 2.84 = 10.01 >= 10.0
      const unknownComponents = Array.from(
        { length: 142 },
        (_, i) => `unknown-component-${i}`,
      );
      const allComponents = [...knownComponents, ...unknownComponents];
      const commonDetails = allComponents.map((name) => ({
        componentName: name,
        componentValueHash: `hash-${name}`,
        fingerprintType: "browser",
      }));
      const v4Detail = {
        componentName: "v4",
        componentValueHash: "v4-same",
        fingerprintType: "telemetry",
      };
      const r1: ResponseWithFingerprints = {
        id: "big-r1",
        fingerprintDetails: [...commonDetails, v4Detail],
      };
      const r2: ResponseWithFingerprints = {
        id: "big-r2",
        fingerprintDetails: [...commonDetails, v4Detail],
      };
      expect(calculateUniqueness(r1, [r1, r2])).toBe(0.0);
    });
  });

  describe("componentMapCache", () => {
    it("produces same results with and without componentMapCache", () => {
      const responses: ResponseWithFingerprints[] = [
        {
          id: "c1",
          sessionId: "s1",
          fingerprintDetails: [
            {
              componentName: "canvas",
              componentValueHash: "canvas-hash-a",
              fingerprintType: "browser",
            },
            {
              componentName: "fonts",
              componentValueHash: "fonts-hash-a",
              fingerprintType: "browser",
            },
          ],
        },
        {
          id: "c2",
          sessionId: "s2",
          fingerprintDetails: [
            {
              componentName: "canvas",
              componentValueHash: "canvas-hash-a",
              fingerprintType: "browser",
            },
            {
              componentName: "fonts",
              componentValueHash: "fonts-hash-b",
              fingerprintType: "browser",
            },
          ],
        },
        {
          id: "c3",
          sessionId: "s3",
          fingerprintDetails: [
            {
              componentName: "canvas",
              componentValueHash: "canvas-hash-c",
              fingerprintType: "browser",
            },
          ],
        },
      ];

      const cache = new Map<string, ReturnType<typeof buildComponentMap>>();
      for (const r of responses) {
        cache.set(r.id, buildComponentMap(r));
      }

      for (const r of responses) {
        const withoutCache = calculateUniqueness(r, responses);
        const withCache = calculateUniqueness(r, responses, cache);
        expect(withCache).toBe(withoutCache);
      }
    });
  });

  describe("calculateAllUniquenessScores", () => {
    it("returns array of { responseId, uniquenessScore } objects", () => {
      const responses: ResponseWithFingerprints[] = [
        {
          id: "x1",
          fingerprintDetails: [
            {
              componentName: "canvas",
              componentValueHash: "hash-unique",
              fingerprintType: "browser",
            },
          ],
        },
        {
          id: "x2",
          fingerprintDetails: [
            {
              componentName: "canvas",
              componentValueHash: "hash-different",
              fingerprintType: "browser",
            },
          ],
        },
      ];
      const result = calculateAllUniquenessScores(responses);
      expect(result).toHaveLength(2);
      for (const item of result) {
        expect(typeof item.responseId).toBe("string");
        expect(typeof item.uniquenessScore).toBe("number");
        expect(item.uniquenessScore).toBeGreaterThanOrEqual(0);
        expect(item.uniquenessScore).toBeLessThanOrEqual(1);
      }
      const ids = result.map((r) => r.responseId);
      expect(ids).toContain("x1");
      expect(ids).toContain("x2");
    });
  });

  describe("v6 immediate-zero (one-shot) negative tests", () => {
    it("does NOT return 0.0 for v6 component with non-matching hash", () => {
      const r1: ResponseWithFingerprints = {
        id: "neg-r1",
        fingerprintDetails: [
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-A",
            fingerprintType: "telemetry",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "neg-r2",
        fingerprintDetails: [
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-B",
            fingerprintType: "telemetry",
          },
        ],
      };
      expect(calculateUniqueness(r1, [r1, r2])).toBe(1.0);
    });

    it("returns 0.0 for v6 component matching regardless of fingerprintType value", () => {
      // buildComponentMap は fingerprintType を区別しないため、
      // v6 コンポーネント名が一致すれば fingerprintType に関わらず一発アウトになる
      const r1: ResponseWithFingerprints = {
        id: "neg-r3",
        fingerprintDetails: [
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-X",
            fingerprintType: "browser",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "neg-r4",
        fingerprintDetails: [
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-X",
            fingerprintType: "telemetry",
          },
        ],
      };
      expect(calculateUniqueness(r1, [r1, r2])).toBe(0.0);
    });

    it("returns 0.0 when target response has multiple v6 entries and one matches", () => {
      const r1: ResponseWithFingerprints = {
        id: "multi-v6-r1",
        fingerprintDetails: [
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-old",
            fingerprintType: "telemetry",
          },
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-new",
            fingerprintType: "telemetry",
          },
        ],
      };
      const r2: ResponseWithFingerprints = {
        id: "multi-v6-r2",
        fingerprintDetails: [
          {
            componentName: "v6",
            componentValueHash: "ipv6-hash-new",
            fingerprintType: "telemetry",
          },
        ],
      };
      // findを使った旧実装では最初の "ipv6-hash-old" のみ照合し見落とす可能性があった
      expect(calculateUniqueness(r1, [r1, r2])).toBe(0.0);
    });
  });
});
