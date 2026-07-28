import {
  buildFingerprintComponentKey,
  COMPONENT_WEIGHTS,
  DEFAULT_COMPONENT_WEIGHT,
} from "@nexus-form/shared";

export interface ResponseWithFingerprints {
  id: string;
  sessionId?: string | null;
  fingerprintDetails: Array<{
    componentKey?: string;
    componentName: string;
    componentValueHash: string;
    fingerprintType: string;
  }>;
}

function getFingerprintComponentKey(
  detail: ResponseWithFingerprints["fingerprintDetails"][number],
): string {
  return (
    detail.componentKey ??
    buildFingerprintComponentKey(detail.fingerprintType, detail.componentName)
  );
}

function calculateSimilarity(
  response1: ResponseWithFingerprints,
  response2: ResponseWithFingerprints,
): number {
  if (
    response1.fingerprintDetails.length === 0 ||
    response2.fingerprintDetails.length === 0
  ) {
    return 0;
  }

  const allComponents = new Set<string>();
  for (const detail of response1.fingerprintDetails) {
    allComponents.add(getFingerprintComponentKey(detail));
  }
  for (const detail of response2.fingerprintDetails) {
    allComponents.add(getFingerprintComponentKey(detail));
  }

  let totalWeight = 0;
  let matchedWeight = 0;
  const details1ByKey = new Map(
    response1.fingerprintDetails.map((detail) => [
      getFingerprintComponentKey(detail),
      detail,
    ]),
  );
  const details2ByKey = new Map(
    response2.fingerprintDetails.map((detail) => [
      getFingerprintComponentKey(detail),
      detail,
    ]),
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

  const targetSessionId = targetResponse.sessionId?.trim();
  if (
    targetSessionId &&
    otherResponses.some(
      (response) => response.sessionId?.trim() === targetSessionId,
    )
  ) {
    return 0.0;
  }

  const similarities: number[] = [];
  for (const otherResponse of otherResponses) {
    similarities.push(calculateSimilarity(targetResponse, otherResponse));
  }

  const avgSimilarity =
    similarities.reduce((sum, sim) => sum + sim, 0) / similarities.length;
  const uniqueness = 1 - avgSimilarity;

  return Math.max(0, Math.min(1, uniqueness));
}

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
