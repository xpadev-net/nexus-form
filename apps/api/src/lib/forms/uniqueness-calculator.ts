/**
 * ユニーク度算出ロジック
 * 回答者のユニーク度を算出するロジックを実装します。
 * 各回答について、他の全回答との類似度を重み付きで計算し、ユニーク度スコア（0-1）を導出します。
 */

import {
  COMPONENT_WEIGHTS,
  DEFAULT_COMPONENT_WEIGHT,
} from "@nexus-form/shared";

/**
 * フィンガープリント詳細を含む回答の型定義
 */
export interface ResponseWithFingerprints {
  id: string;
  fingerprintDetails: Array<{
    componentKey: string;
    componentName: string;
    componentValueHash: string;
    fingerprintType: string;
  }>;
}

/**
 * 2つの回答間の類似度を重み付きで計算
 */
export function calculateSimilarity(
  response1: ResponseWithFingerprints,
  response2: ResponseWithFingerprints,
): number {
  if (
    response1.fingerprintDetails.length === 0 ||
    response2.fingerprintDetails.length === 0
  ) {
    return 0;
  }

  // 両回答の和集合で重みを正規化して非対称性を解消
  const allComponents = new Set<string>();

  for (const detail of response1.fingerprintDetails) {
    allComponents.add(detail.componentKey);
  }
  for (const detail of response2.fingerprintDetails) {
    allComponents.add(detail.componentKey);
  }

  let totalWeight = 0;
  let matchedWeight = 0;
  const details1ByKey = new Map(
    response1.fingerprintDetails.map((detail) => [detail.componentKey, detail]),
  );
  const details2ByKey = new Map(
    response2.fingerprintDetails.map((detail) => [detail.componentKey, detail]),
  );

  for (const componentKey of allComponents) {
    const detail1 = details1ByKey.get(componentKey);
    const detail2 = details2ByKey.get(componentKey);
    const componentName =
      detail1?.componentName ?? detail2?.componentName ?? componentKey;
    const weight = COMPONENT_WEIGHTS[componentName] ?? DEFAULT_COMPONENT_WEIGHT;
    totalWeight += weight;

    if (
      detail1 &&
      detail2 &&
      detail1.componentValueHash === detail2.componentValueHash &&
      detail1.fingerprintType === detail2.fingerprintType
    ) {
      matchedWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return 0;
  }

  return matchedWeight / totalWeight;
}

/**
 * 対象回答のユニーク度を算出する（0-1のスコア）
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

  const similarities: number[] = [];
  for (const otherResponse of otherResponses) {
    const similarity = calculateSimilarity(targetResponse, otherResponse);
    similarities.push(similarity);
  }

  const avgSimilarity =
    similarities.reduce((sum, sim) => sum + sim, 0) / similarities.length;

  const uniqueness = 1 - avgSimilarity;

  return Math.max(0, Math.min(1, uniqueness));
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
