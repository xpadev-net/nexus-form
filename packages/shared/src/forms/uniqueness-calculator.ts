/**
 * ユニーク度算出ロジック
 * 回答者のユニーク度を算出するロジックを実装します。
 * 減点方式（Matched Weight Deduction Model）を採用し、
 * 一致した指紋要素の信頼度（重み）の合計に応じてユニーク度スコア（1.0 -> 0.0）を減少させます。
 *
 * 識別力の低いノイズ項目（OS名、標準解像度、標準言語等）の重みを大幅に引き下げ、
 * Wi-Fiとモバイル回線等でIPが異なるケースでも、高識別指紋（Canvas, WebGL, Fonts, Audio, WebRTC）を
 * もとに同端末・同一人物を精度高く識別・減点します。
 */

import {
  COMPONENT_WEIGHTS,
  DEFAULT_COMPONENT_WEIGHT,
} from "../constants/fingerprint-weights";

/**
 * フィンガープリント詳細を含む回答の型定義
 */
export interface ResponseWithFingerprints {
  id: string;
  sessionId?: string | null;
  fingerprintDetails: Array<{
    componentName: string;
    componentValueHash: string;
    fingerprintType: string;
  }>;
}

/**
 * 2つの回答間で一致した指紋項目の信頼度（重み）の合計を計算する
 * プロバイダー間（fingerprintjs と thumbmarkjs 等）での重みの二重カウントを防止し、
 * コンポーネント単位でデデュープして評価します。
 */
export function calculatePairwiseMatchedWeight(
  response1: ResponseWithFingerprints,
  response2: ResponseWithFingerprints,
): { v4Match: boolean; v6Match: boolean; matchedWeight: number } {
  if (
    response1.fingerprintDetails.length === 0 ||
    response2.fingerprintDetails.length === 0
  ) {
    return { v4Match: false, v6Match: false, matchedWeight: 0 };
  }

  const r1CompMap = new Map<string, Set<string>>();
  for (const d of response1.fingerprintDetails) {
    if (!r1CompMap.has(d.componentName)) {
      r1CompMap.set(d.componentName, new Set());
    }
    r1CompMap.get(d.componentName)?.add(d.componentValueHash);
  }

  const r2CompMap = new Map<string, Set<string>>();
  for (const d of response2.fingerprintDetails) {
    if (!r2CompMap.has(d.componentName)) {
      r2CompMap.set(d.componentName, new Set());
    }
    r2CompMap.get(d.componentName)?.add(d.componentValueHash);
  }

  // 1. IP (telemetry) の一致判定
  const v4_1 = r1CompMap.get("v4");
  const v4_2 = r2CompMap.get("v4");
  const v6_1 = r1CompMap.get("v6");
  const v6_2 = r2CompMap.get("v6");

  const v4Match = Boolean(v4_1 && v4_2 && [...v4_1].some((h) => v4_2.has(h)));
  const v6Match = Boolean(v6_1 && v6_2 && [...v6_1].some((h) => v6_2.has(h)));

  // 2. その他のブラウザ指紋要素の一致判定（コンポーネント名でデデュープ）
  let matchedWeight = 0;
  for (const [compName, hashes1] of r1CompMap.entries()) {
    if (compName === "v4" || compName === "v6") continue;
    const hashes2 = r2CompMap.get(compName);
    if (hashes2 && [...hashes1].some((h) => hashes2.has(h))) {
      const weight = COMPONENT_WEIGHTS[compName] ?? DEFAULT_COMPONENT_WEIGHT;
      matchedWeight += weight;
    }
  }

  // IPが一致している場合は加重ボーナス
  if (v4Match) {
    matchedWeight += COMPONENT_WEIGHTS.v4 ?? 0.5;
  }
  if (v6Match) {
    matchedWeight += COMPONENT_WEIGHTS.v6 ?? 0.5;
  }

  return {
    v4Match,
    v6Match,
    matchedWeight,
  };
}

/**
 * 対象回答のユニーク度を算出する（0.0 - 1.0 のスコア）
 */
export function calculateUniqueness(
  targetResponse: ResponseWithFingerprints,
  allResponses: ResponseWithFingerprints[],
): number {
  if (allResponses.length <= 1) {
    return 1.0;
  }

  const otherResponses = allResponses.filter(
    (response) => response.id !== targetResponse.id,
  );

  if (otherResponses.length === 0) {
    return 1.0;
  }

  // 1. Session ID が一致する場合は即 0.0 (一発アウト)
  const targetSessionId = targetResponse.sessionId?.trim();
  if (
    targetSessionId &&
    otherResponses.some(
      (response) => response.sessionId?.trim() === targetSessionId,
    )
  ) {
    return 0.0;
  }

  // 2. v6 (IPv6) トークンが一致する場合は即 0.0 (一発アウト)
  const targetV6 = targetResponse.fingerprintDetails.find(
    (d) => d.fingerprintType === "telemetry" && d.componentName === "v6",
  );
  if (targetV6?.componentValueHash) {
    const hasV6Match = otherResponses.some((other) =>
      other.fingerprintDetails.some(
        (d) =>
          d.fingerprintType === "telemetry" &&
          d.componentName === "v6" &&
          d.componentValueHash === targetV6.componentValueHash,
      ),
    );
    if (hasV6Match) {
      return 0.0;
    }
  }

  // 3. 他の全回答の中で、最も一致重みの大きかった相手を探索
  let maxMatchedWeight = 0;

  for (const otherResponse of otherResponses) {
    const p = calculatePairwiseMatchedWeight(targetResponse, otherResponse);
    if (p.matchedWeight > maxMatchedWeight) {
      maxMatchedWeight = p.matchedWeight;
    }
  }

  // 4. 重み減点モデルによるユニーク度スコア算出
  // - ノイズ範囲（matchedWeight <= 3.0） -> 0.90 ~ 1.00
  // - 類似ブラウザ（3.0 < matchedWeight <= 6.0） -> 0.40 ~ 0.89
  // - 同一端末・同一人物（Wi-Fi/モバイル切り替え、あるいは同一IPの重複）(matchedWeight > 6.0) -> 0.0000 付近へ急速減少
  if (maxMatchedWeight <= 3.0) {
    return Number((1.0 - (maxMatchedWeight / 3.0) * 0.1).toFixed(4));
  } else if (maxMatchedWeight <= 6.0) {
    const extra = maxMatchedWeight - 3.0;
    return Number((0.9 - (extra / 3.0) * 0.5).toFixed(4));
  } else {
    const extra = maxMatchedWeight - 6.0;
    return Math.max(0.0, Number((0.4 - extra * 0.25).toFixed(4)));
  }
}

/**
 * 複数の回答のユニーク度を一括計算
 */
export function calculateAllUniquenessScores(
  responses: ResponseWithFingerprints[],
): Array<{ responseId: string; uniquenessScore: number }> {
  return responses.map((response) => ({
    responseId: response.id,
    uniquenessScore: calculateUniqueness(response, responses),
  }));
}

export function calculateUniquenessScoreMap(
  responses: ResponseWithFingerprints[],
): Map<string, number> {
  return new Map(
    calculateAllUniquenessScores(responses).map((score) => [
      score.responseId,
      score.uniquenessScore,
    ]),
  );
}
