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
 * ペア一致評価結果の名前付き型定義
 */
export interface PairwiseMatchResult {
  v4Match: boolean;
  v6Match: boolean;
  ipMatchedWeight: number;
  matchedWeight: number;
}

export type UniquenessRatingLabel = "高" | "中" | "低";

/**
 * ユニーク度スコアから 3 段階の評価（"高" | "中" | "低"）を判定する
 */
export function getUniquenessScoreRating(
  score: number | null | undefined,
): UniquenessRatingLabel | "" {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "";
  }
  if (score >= 0.9) {
    return "高";
  }
  if (score >= 0.4) {
    return "中";
  }
  return "低";
}

export type ComponentMap = Map<string, Set<string>>;

/**
 * 回答データの指紋詳細から componentName -> Set<componentValueHash> のマップを構築する
 */
export function buildComponentMap(
  response: ResponseWithFingerprints,
): ComponentMap {
  const compMap = new Map<string, Set<string>>();
  for (const d of response.fingerprintDetails) {
    let set = compMap.get(d.componentName);
    if (!set) {
      set = new Set<string>();
      compMap.set(d.componentName, set);
    }
    set.add(d.componentValueHash);
  }
  return compMap;
}

/**
 * 2つの Set 間で共通の要素（Intersection）が存在するか判定する共通ヘルパー
 */
export function hasSetIntersection(
  set1?: Set<string>,
  set2?: Set<string>,
): boolean {
  if (!set1 || !set2 || set1.size === 0 || set2.size === 0) {
    return false;
  }
  return [...set1].some((item) => set2.has(item));
}

/**
 * 2つの回答間（または事前構築された ComponentMap 間）で一致した指紋項目の信頼度（重み）の合計を計算する
 * デュアルスタック (IPv4+IPv6) とシングルスタックの環境特性に応じた動的 IP 重み評価を行い、
 * プロバイダー間での重みの二重カウントを防止し、コンポーネント単位でデデュープして評価します。
 */
export function calculatePairwiseMatchedWeight(
  response1: ResponseWithFingerprints | ComponentMap,
  response2: ResponseWithFingerprints | ComponentMap,
): PairwiseMatchResult {
  const r1CompMap =
    response1 instanceof Map ? response1 : buildComponentMap(response1);
  const r2CompMap =
    response2 instanceof Map ? response2 : buildComponentMap(response2);

  if (r1CompMap.size === 0 || r2CompMap.size === 0) {
    return {
      v4Match: false,
      v6Match: false,
      ipMatchedWeight: 0,
      matchedWeight: 0,
    };
  }

  // 1. IP (telemetry) の動的評価
  const v4_1 = r1CompMap.get("v4");
  const v4_2 = r2CompMap.get("v4");
  const v6_1 = r1CompMap.get("v6");
  const v6_2 = r2CompMap.get("v6");

  const r1HasV4 = Boolean(v4_1 && v4_1.size > 0);
  const r1HasV6 = Boolean(v6_1 && v6_1.size > 0);
  const r2HasV4 = Boolean(v4_2 && v4_2.size > 0);
  const r2HasV6 = Boolean(v6_2 && v6_2.size > 0);

  const isDualStack = (r1HasV4 && r1HasV6) || (r2HasV4 && r2HasV6);

  const v4Match = hasSetIntersection(v4_1, v4_2);
  const v6Match = hasSetIntersection(v6_1, v6_2);

  let ipMatchedWeight = 0;
  if (isDualStack) {
    // デュアルスタック環境
    if (v4Match && v6Match) {
      ipMatchedWeight = 3.0; // 両方一致で強力な即時・急降下減点
    } else if (v4Match || v6Match) {
      ipMatchedWeight = 1.0; // モバイル回線等のIP変動を考慮した減点
    }
  } else {
    // シングルスタック環境（v4のみ / v6のみ）
    if (v4Match || v6Match) {
      ipMatchedWeight = 2.2; // 存在するプロトコルの高い識別力
    }
  }

  // 2. その他のブラウザ指紋要素の一致判定（コンポーネント名でデデュープ）
  let otherMatchedWeight = 0;
  for (const [compName, hashes1] of r1CompMap.entries()) {
    if (compName === "v4" || compName === "v6") continue;
    const hashes2 = r2CompMap.get(compName);
    if (hasSetIntersection(hashes1, hashes2)) {
      const weight = COMPONENT_WEIGHTS[compName] ?? DEFAULT_COMPONENT_WEIGHT;
      otherMatchedWeight += weight;
    }
  }

  const totalMatchedWeight = ipMatchedWeight + otherMatchedWeight;

  return {
    v4Match,
    v6Match,
    ipMatchedWeight,
    matchedWeight: totalMatchedWeight,
  };
}

/**
 * 対象回答のユニーク度を算出する（0.0 - 1.0 のスコア）
 */
export function calculateUniqueness(
  targetResponse: ResponseWithFingerprints,
  allResponses: ResponseWithFingerprints[],
  componentMapCache?: Map<string, ComponentMap>,
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
  const targetCompMap =
    componentMapCache?.get(targetResponse.id) ??
    buildComponentMap(targetResponse);

  let maxMatchedWeight = 0;

  for (const otherResponse of otherResponses) {
    const otherCompMap =
      componentMapCache?.get(otherResponse.id) ??
      buildComponentMap(otherResponse);

    const p = calculatePairwiseMatchedWeight(targetCompMap, otherCompMap);
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
  // 事前に各レスポンスの ComponentMap を1回だけ構築して使い回す
  const cache = new Map<string, ComponentMap>();
  for (const response of responses) {
    cache.set(response.id, buildComponentMap(response));
  }

  return responses.map((response) => ({
    responseId: response.id,
    uniquenessScore: calculateUniqueness(response, responses, cache),
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
