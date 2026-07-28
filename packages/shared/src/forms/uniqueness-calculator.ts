/**
 * ユニーク度算出ロジック
 * 回答者のユニーク度を算出するロジックを実装します。
 * 減点方式（Matched Weight Deduction Model）を採用し、
 * 一致した指紋要素の信頼度（重み）の合計に応じてユニーク度スコア（1.0 -> 0.0）を減少させます。
 *
 * 実運用データの分散分析を踏まえ、真に個人を識別できるシグナル
 * （Canvas, Fonts, System, Screen）を主軸に据え、ハードウェア homogeneity で衝突多発する
 * Audio/WebGL/WebRTC の重みを引き下げています。また Wi-Fi/モバイル回線切替でIPが異なる
 * ケースでも、高識別指紋の一致から同端末・同一人物を精度高く識別・減点します。
 * 詳細な重み定義は `../constants/fingerprint-weights` を参照。
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
 *
 * 閾値は実運用データの分布を踏まえて調整:
 * - 高: ユニーク性が高く、他者と容易に区別できる回答
 * - 中: 類似ブラウザ環境との一致があり、ユニーク性は中程度
 * - 低: 強い重複証拠がある、または v6/sessionId 一発アウト
 */
export function getUniquenessScoreRating(
  score: number | null | undefined,
): UniquenessRatingLabel | "" {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "";
  }
  if (score >= 0.8) {
    return "高";
  }
  if (score >= 0.5) {
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

  // 片方の回答者がデュアルスタック（v4+v6 を同時保持）であれば、ペア全体をデュアルとして扱う。
  // デュアルスタック環境ではモバイル回線切替等でIPが変動しやすいため、
  // v4 のみ一致でも 1.0（低減点）に留め、誤検知を抑制する設計。
  // 片方だけシングルスタックでも同様にデュアル扱いにするのは、
  // どちらの回答者がデュアルスタック環境にいるか不明なケースへの安全側フォールバック。
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

  // 2. v6 (IPv6) テレメトリートークンが一致する場合は即 0.0 (一発アウト)
  // buildComponentMap は fingerprintType を区別しないため、v6 判定専用に
  // telemetry プロバイダーのエントリのみを抽出して Set を構築する。
  // 非 telemetry プロバイダーの「v6」コンポーネントを誤検知しないようにするため。
  const targetV6TelemetryHashes = new Set(
    targetResponse.fingerprintDetails
      .filter(
        (d) => d.componentName === "v6" && d.fingerprintType === "telemetry",
      )
      .map((d) => d.componentValueHash),
  );
  if (targetV6TelemetryHashes.size > 0) {
    const hasV6Match = otherResponses.some((other) =>
      other.fingerprintDetails.some(
        (d) =>
          d.componentName === "v6" &&
          d.fingerprintType === "telemetry" &&
          targetV6TelemetryHashes.has(d.componentValueHash),
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
  //
  // 実運用データの分布を踏まえ、重みが高いほど同一人物寄りと判断する設計に調整。
  //
  // - 高帯: ユニーク性が高い領域ではほぼ減点しない。
  // - 中帯: 一部一致があるが同一性確度は中程度。
  // - 低帯: 重複の根拠が揃うほど急速に減点し、同一疑いを強める。
  if (maxMatchedWeight <= 3.0) {
    return Number((1.0 - (maxMatchedWeight / 3.0) * 0.1).toFixed(4));
  } else if (maxMatchedWeight <= 5.5) {
    const extra = maxMatchedWeight - 3.0;
    return Number((0.9 - (extra / 2.5) * 0.25).toFixed(4));
  } else if (maxMatchedWeight <= 8.0) {
    const extra = maxMatchedWeight - 5.5;
    return Number((0.65 - (extra / 2.5) * 0.45).toFixed(4));
  } else {
    const extra = maxMatchedWeight - 8.0;
    return Math.max(0.0, Number((0.2 - extra * 0.1).toFixed(4)));
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

/**
 * 複数の回答のユニーク度を一括計算し、responseId をキーとした Map を返す
 */
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
