/**
 * ユニーク度算出ロジック
 * 回答者のユニーク度を算出するロジックを実装します。
 * 減点方式（Matched Weight Deduction Model）を採用し、
 * 一致した指紋要素の信頼度（重み）の合計に応じてユニーク度スコア（1.0 -> 0.0）を減少させます。
 * IPアドレス（v4/v6）を最も強力な識別シグナルとして位置付け、
 * IPが不一致の一般的ユーザーが同一端末モデルの標準ブラウザ要素（ノイズ）で過剰減点されないよう保護します。
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
): {
  v4Match: boolean;
  v6Match: boolean;
  otherWeight: number;
  totalWeight: number;
} {
  if (
    response1.fingerprintDetails.length === 0 ||
    response2.fingerprintDetails.length === 0
  ) {
    return { v4Match: false, v6Match: false, otherWeight: 0, totalWeight: 0 };
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
  let otherWeight = 0;
  for (const [compName, hashes1] of r1CompMap.entries()) {
    if (compName === "v4" || compName === "v6") continue;
    const hashes2 = r2CompMap.get(compName);
    if (hashes2 && [...hashes1].some((h) => hashes2.has(h))) {
      const weight = COMPONENT_WEIGHTS[compName] ?? DEFAULT_COMPONENT_WEIGHT;
      otherWeight += weight;
    }
  }

  let ipWeight = 0;
  if (v4Match && v6Match) ipWeight = 4.0;
  else if (v4Match) ipWeight = 3.0;
  else if (v6Match) ipWeight = 4.0;

  return {
    v4Match,
    v6Match,
    otherWeight,
    totalWeight: ipWeight + otherWeight,
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
  let maxV4MatchedWeight = 0;
  let hasV4Match = false;
  let maxDifferentIPMatchedWeight = 0;

  for (const otherResponse of otherResponses) {
    const p = calculatePairwiseMatchedWeight(targetResponse, otherResponse);
    if (p.v4Match) {
      hasV4Match = true;
      if (p.otherWeight > maxV4MatchedWeight) {
        maxV4MatchedWeight = p.otherWeight;
      }
    } else {
      if (p.otherWeight > maxDifferentIPMatchedWeight) {
        maxDifferentIPMatchedWeight = p.otherWeight;
      }
    }
  }

  // ケースA: 同一 IPv4 アドレスの一致相手が存在する場合
  // 同じIPアドレスから送信され、指紋要素の一致重みが一定（>2.0）以上重なる場合は確定重複・同一アクター（スコア 0.0）
  if (hasV4Match) {
    if (maxV4MatchedWeight >= 2.0) {
      return Math.max(0.0, Number((1.0 - maxV4MatchedWeight / 3.5).toFixed(4)));
    }
  }

  // ケースB: 異なる IP アドレスの相手との比較
  // ブラウザ標準環境（OS/言語/標準解像度/標準フォント等）のノイズ上限値 = 6.0
  // W <= 6.0 の場合はノイズ範囲内としてスコア 0.90 ~ 1.00 を保護
  // W > 6.0 (同一型番端末の完全一致等) の場合も、IPが異なる一般ユーザーとして 0.60 ~ 0.85 を維持
  if (maxDifferentIPMatchedWeight <= 6.0) {
    return Number((1.0 - (maxDifferentIPMatchedWeight / 6.0) * 0.1).toFixed(4));
  }

  const extraNoise = maxDifferentIPMatchedWeight - 6.0;
  return Math.max(0.6, Number((0.9 - (extraNoise / 6.0) * 0.25).toFixed(4)));
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
