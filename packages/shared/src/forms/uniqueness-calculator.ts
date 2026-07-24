/**
 * ユニーク度算出ロジック
 * 回答者のユニーク度を算出するロジックを実装します。
 * 減点方式（Matched Weight Deduction Model）を採用し、
 * 一致した指紋要素の信頼度（重み）の合計に応じてユニーク度スコア（1.0 -> 0.0）を減少させます。
 * 不一致項目は単に無視され、別アクターであることの証明としては扱いません。
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
 */
export function calculatePairwiseMatchedWeight(
  response1: ResponseWithFingerprints,
  response2: ResponseWithFingerprints,
): number {
  if (
    response1.fingerprintDetails.length === 0 ||
    response2.fingerprintDetails.length === 0
  ) {
    return 0;
  }

  const r1Map = new Map<
    string,
    (typeof response1.fingerprintDetails)[number]
  >();
  for (const d of response1.fingerprintDetails) {
    r1Map.set(`${d.fingerprintType}:${d.componentName}`, d);
  }

  const r2Map = new Map<
    string,
    (typeof response2.fingerprintDetails)[number]
  >();
  for (const d of response2.fingerprintDetails) {
    r2Map.set(`${d.fingerprintType}:${d.componentName}`, d);
  }

  // 1. IP (telemetry) の動的重み判定
  const hasV4_1 = r1Map.has("telemetry:v4");
  const hasV6_1 = r1Map.has("telemetry:v6");
  const hasV4_2 = r2Map.has("telemetry:v4");
  const hasV6_2 = r2Map.has("telemetry:v6");

  const v4Match =
    r1Map.has("telemetry:v4") &&
    r2Map.has("telemetry:v4") &&
    r1Map.get("telemetry:v4")?.componentValueHash ===
      r2Map.get("telemetry:v4")?.componentValueHash;

  const v6Match =
    r1Map.has("telemetry:v6") &&
    r2Map.has("telemetry:v6") &&
    r1Map.get("telemetry:v6")?.componentValueHash ===
      r2Map.get("telemetry:v6")?.componentValueHash;

  let ipMatchedWeight = 0;
  const isDualStack = (hasV4_1 && hasV6_1) || (hasV4_2 && hasV6_2);

  if (isDualStack) {
    // デュアルスタック環境
    if (v4Match && v6Match) {
      ipMatchedWeight = 2.0; // 両方一致で最高重み
    } else if (v4Match || v6Match) {
      ipMatchedWeight = 0.7; // モバイル回線等の変動を考慮して少し低い重み
    }
  } else {
    // シングルスタック環境（v4のみ / v6のみ）
    if (v4Match || v6Match) {
      ipMatchedWeight = 1.5; // 存在するプロトコルの高い識別力
    }
  }

  // 2. その他のブラウザ指紋要素の一致判定
  let otherMatchedWeight = 0;
  for (const [key, detail1] of r1Map.entries()) {
    if (key.startsWith("telemetry:")) continue; // IPは個別判定済みのため除外

    const detail2 = r2Map.get(key);
    if (detail2 && detail1.componentValueHash === detail2.componentValueHash) {
      const componentName = key.split(":")[1];
      const weight =
        (componentName ? COMPONENT_WEIGHTS[componentName] : undefined) ??
        DEFAULT_COMPONENT_WEIGHT;
      otherMatchedWeight += weight;
    }
  }

  return ipMatchedWeight + otherMatchedWeight;
}

/**
 * 一致重み (Matched Weight) を [0.0, 1.0] の連続した滑らかなユニーク度スコアに正規化する
 * - W <= 1.4 (自然な別人のノイズ一致) -> 0.90 ~ 1.00 (e.g. W=1.4 で ~0.9577)
 * - W = 4.0 (中間・グレーゾーン) -> ~0.5250
 * - W >= 7.0 (同一環境・重複投稿) -> ~0.0661 -> 0.00
 */
export function normalizeMatchedWeightToUniqueness(
  matchedWeight: number,
): number {
  if (matchedWeight <= 0) {
    return 1.0;
  }

  const midpoint = 4.0;
  const slope = 0.9;
  const rawScore = 1.0 / (1.0 + Math.exp(slope * (matchedWeight - midpoint)));
  const scaled = rawScore * 1.05;

  return Math.max(0.0, Math.min(1.0, Number(scaled.toFixed(4))));
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
    const matchedWeight = calculatePairwiseMatchedWeight(
      targetResponse,
      otherResponse,
    );
    if (matchedWeight > maxMatchedWeight) {
      maxMatchedWeight = matchedWeight;
    }
  }

  // シグモイド正規化関数で 0.0 ~ 1.0 にスケーリング
  return normalizeMatchedWeightToUniqueness(maxMatchedWeight);
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
