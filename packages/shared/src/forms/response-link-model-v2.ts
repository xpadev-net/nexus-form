import { buildFingerprintComponentKey } from "../fingerprint";

export const RESPONSE_LINK_MODEL_VERSION = "response-link-v2-rarity-shadow";

export const RESPONSE_LINK_STRENGTHS = [
  "NONE",
  "SUPPORT",
  "STRONG",
  "HARD",
] as const;

export type ResponseLinkStrength = (typeof RESPONSE_LINK_STRENGTHS)[number];

export const RESPONSE_LINK_FAMILIES = [
  "composite",
  "rendering",
  "fonts",
  "display",
  "system",
  "hardware",
  "audio",
  "network",
  "state",
] as const;

export type ResponseLinkFamily = (typeof RESPONSE_LINK_FAMILIES)[number];

export type CanonicalSignalQuality = "usable" | "missing" | "error";

export type FingerprintSignalInput = {
  responseId: string;
  fingerprintType: string;
  componentName: string;
  componentValueHash: string;
  componentValue?: string | null;
};

export type CanonicalFingerprintSignal = {
  responseId: string;
  family: ResponseLinkFamily;
  key: string;
  componentName: string;
  fingerprintType: string;
  valueHash: string;
  quality: CanonicalSignalQuality;
};

export type ResponseLinkAnalysisResponse = {
  id: string;
  sessionId?: string | null;
  respondentUuid?: string | null;
  userAgent?: string | null;
  fingerprintDetails: FingerprintSignalInput[];
};

export type RarityStats = {
  statsVersion: string;
  populationSize: number;
  signalPopulationByKey: Map<string, number>;
  documentFrequencyByKeyValue: Map<string, number>;
};

export type FamilyContribution = {
  family: ResponseLinkFamily;
  score: number;
  reasonCodes: string[];
};

export type PairEvidenceBreakdown = {
  modelVersion: typeof RESPONSE_LINK_MODEL_VERSION;
  strength: ResponseLinkStrength;
  deviceEvidence: number;
  familyContributions: FamilyContribution[];
  v4Support: boolean;
  v6Strong: boolean;
  stateSupport: boolean;
  populationSize: number;
  statsVersion: string;
  reasonCodes: string[];
};

export type ResponsePairLinkEvaluation = PairEvidenceBreakdown & {
  responseIdA: string;
  responseIdB: string;
};

export type ResponseSuspicionGroupEvaluation = {
  groupKey: string;
  technicalConfidence: ResponseLinkStrength;
  responseIds: string[];
  strongLinkCount: number;
  supportLinkCount: number;
  summary: {
    reasonCodes: string[];
    topFamilies: FamilyContribution[];
    denseBucket?: {
      omittedPairLinks: boolean;
      pairCount: number;
      reasonCode: string;
      strength: Extract<ResponseLinkStrength, "HARD" | "STRONG">;
    };
  };
};

type ComponentConfig = {
  family: Exclude<ResponseLinkFamily, "network" | "state">;
  capBits: number;
  reliability: number;
};

const COMPONENT_CONFIG_BY_NAME: Record<string, ComponentConfig> = {
  canvas: { family: "rendering", capBits: 6, reliability: 1.2 },
  webgl: { family: "rendering", capBits: 5, reliability: 0.35 },
  webGlBasics: { family: "rendering", capBits: 5, reliability: 0.5 },
  webGlExtensions: { family: "rendering", capBits: 5, reliability: 0.35 },
  fonts: { family: "fonts", capBits: 6, reliability: 1.4 },
  screen: { family: "display", capBits: 4, reliability: 0.35 },
  screenResolution: { family: "display", capBits: 4, reliability: 0.3 },
  screenFrame: { family: "display", capBits: 4, reliability: 0.3 },
  colorDepth: { family: "display", capBits: 3, reliability: 0.1 },
  system: { family: "system", capBits: 4, reliability: 0.45 },
  userAgentData: { family: "system", capBits: 4, reliability: 0.25 },
  platform: { family: "system", capBits: 3, reliability: 0.15 },
  userAgent: { family: "system", capBits: 4, reliability: 0.2 },
  hardwareConcurrency: { family: "hardware", capBits: 3, reliability: 0.2 },
  hardware: { family: "hardware", capBits: 3, reliability: 0.12 },
  deviceMemory: { family: "hardware", capBits: 3, reliability: 0.12 },
  audio: { family: "audio", capBits: 3, reliability: 0.18 },
  audioBaseLatency: { family: "audio", capBits: 3, reliability: 0.08 },
  speech: { family: "audio", capBits: 4, reliability: 0.1 },
};

const FAMILY_CAPS = {
  composite: 3.0,
  rendering: 1.6,
  fonts: 1.8,
  display: 0.8,
  system: 0.8,
  hardware: 0.5,
  audio: 0.4,
} satisfies Record<Exclude<ResponseLinkFamily, "network" | "state">, number>;

const STRONG_DEVICE_EVIDENCE_THRESHOLD = 1.6;
const SUPPORT_DEVICE_EVIDENCE_THRESHOLD = 0.25;
const MIN_POPULATION_FOR_FULL_RARITY = 30;
const RARITY_ALPHA = 1;

function keyValueId(key: string, valueHash: string): string {
  return `${key}\0${valueHash}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isBlankish(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" || normalized === "undefined" || normalized === "null"
  );
}

function isErrorValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("error:") ||
    normalized.includes("collector timeout") ||
    normalized.includes("serialization failure") ||
    normalized.includes("schema failure")
  );
}

function getComponentConfig(
  fingerprintType: string,
  componentName: string,
): ComponentConfig | null {
  if (fingerprintType === "fingerprintjs" && componentName === "visitorId") {
    return { family: "composite", capBits: 8, reliability: 3.0 };
  }
  return COMPONENT_CONFIG_BY_NAME[componentName] ?? null;
}

export function canonicalizeFingerprintSignal(
  input: FingerprintSignalInput,
): CanonicalFingerprintSignal {
  const key = buildFingerprintComponentKey(
    input.fingerprintType,
    input.componentName,
  );
  const valueHash = input.componentValueHash.trim();
  const quality: CanonicalSignalQuality = isBlankish(valueHash)
    ? "missing"
    : isErrorValue(input.componentValue)
      ? "error"
      : "usable";

  if (
    input.fingerprintType === "telemetry" &&
    (input.componentName === "v4" || input.componentName === "v6")
  ) {
    return {
      responseId: input.responseId,
      family: "network",
      key,
      componentName: input.componentName,
      fingerprintType: input.fingerprintType,
      valueHash,
      quality,
    };
  }

  const config = getComponentConfig(input.fingerprintType, input.componentName);
  return {
    responseId: input.responseId,
    family: config?.family ?? "state",
    key,
    componentName: input.componentName,
    fingerprintType: input.fingerprintType,
    valueHash,
    quality,
  };
}

export function canonicalizeResponseSignals(
  response: ResponseLinkAnalysisResponse,
): CanonicalFingerprintSignal[] {
  return response.fingerprintDetails.map((detail) =>
    canonicalizeFingerprintSignal(detail),
  );
}

export function buildRarityStats(
  responses: ResponseLinkAnalysisResponse[],
): RarityStats {
  const signalPopulationByKey = new Map<string, Set<string>>();
  const documentFrequencySets = new Map<string, Set<string>>();

  for (const response of responses) {
    for (const signal of canonicalizeResponseSignals(response)) {
      if (signal.quality !== "usable") continue;
      if (signal.family === "network") continue;

      let populationSet = signalPopulationByKey.get(signal.key);
      if (!populationSet) {
        populationSet = new Set<string>();
        signalPopulationByKey.set(signal.key, populationSet);
      }
      populationSet.add(response.id);

      const dfKey = keyValueId(signal.key, signal.valueHash);
      let dfSet = documentFrequencySets.get(dfKey);
      if (!dfSet) {
        dfSet = new Set<string>();
        documentFrequencySets.set(dfKey, dfSet);
      }
      dfSet.add(response.id);
    }
  }

  const signalPopulation = new Map<string, number>();
  for (const [key, set] of signalPopulationByKey) {
    signalPopulation.set(key, set.size);
  }
  const documentFrequency = new Map<string, number>();
  for (const [key, set] of documentFrequencySets) {
    documentFrequency.set(key, set.size);
  }

  return {
    statsVersion: `${RESPONSE_LINK_MODEL_VERSION}:${responses.length}:${Date.now()}`,
    populationSize: responses.length,
    signalPopulationByKey: signalPopulation,
    documentFrequencyByKeyValue: documentFrequency,
  };
}

function getRarityBits(signal: CanonicalFingerprintSignal, stats: RarityStats) {
  const config = getComponentConfig(
    signal.fingerprintType,
    signal.componentName,
  );
  if (!config) return 0;

  const population = stats.signalPopulationByKey.get(signal.key) ?? 0;
  const df = stats.documentFrequencyByKeyValue.get(
    keyValueId(signal.key, signal.valueHash),
  );
  if (!df || population <= 1) return 0;

  const raw = Math.log2((population + RARITY_ALPHA) / (df + RARITY_ALPHA));
  const populationScale =
    population >= MIN_POPULATION_FOR_FULL_RARITY
      ? 1
      : Math.max(0.25, population / MIN_POPULATION_FOR_FULL_RARITY);
  return Math.min(config.capBits * populationScale, raw);
}

function buildUsableSignalMap(
  response: ResponseLinkAnalysisResponse,
): Map<string, CanonicalFingerprintSignal[]> {
  const map = new Map<string, CanonicalFingerprintSignal[]>();
  for (const signal of canonicalizeResponseSignals(response)) {
    if (signal.quality !== "usable") continue;
    const current = map.get(signal.key) ?? [];
    current.push(signal);
    map.set(signal.key, current);
  }
  return map;
}

function hasMatchingSignal(
  left: Map<string, CanonicalFingerprintSignal[]>,
  right: Map<string, CanonicalFingerprintSignal[]>,
  predicate: (signal: CanonicalFingerprintSignal) => boolean,
): boolean {
  for (const [key, leftSignals] of left) {
    const rightSignals = right.get(key);
    if (!rightSignals) continue;
    for (const leftSignal of leftSignals) {
      if (!predicate(leftSignal)) continue;
      if (
        rightSignals.some(
          (rightSignal) => rightSignal.valueHash === leftSignal.valueHash,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function calculateFamilyContributions(
  left: Map<string, CanonicalFingerprintSignal[]>,
  right: Map<string, CanonicalFingerprintSignal[]>,
  stats: RarityStats,
): FamilyContribution[] {
  const componentScoresByFamily = new Map<
    Exclude<ResponseLinkFamily, "network" | "state">,
    Array<{ score: number; reasonCode: string }>
  >();

  for (const [key, leftSignals] of left) {
    const rightSignals = right.get(key);
    if (!rightSignals) continue;

    let bestSignalScore = 0;
    let bestReasonCode: string | null = null;
    for (const leftSignal of leftSignals) {
      if (leftSignal.family === "network" || leftSignal.family === "state") {
        continue;
      }
      if (
        !rightSignals.some(
          (rightSignal) => rightSignal.valueHash === leftSignal.valueHash,
        )
      ) {
        continue;
      }
      const config = getComponentConfig(
        leftSignal.fingerprintType,
        leftSignal.componentName,
      );
      if (!config) continue;

      const rarityBits = getRarityBits(leftSignal, stats);
      const score =
        config.capBits > 0
          ? config.reliability * Math.min(1, rarityBits / config.capBits)
          : 0;
      if (score > bestSignalScore) {
        bestSignalScore = score;
        bestReasonCode = `match:${leftSignal.key}`;
      }
    }

    if (bestSignalScore <= 0 || !bestReasonCode) continue;
    const sampleSignal = leftSignals[0];
    if (!sampleSignal) continue;
    const config = getComponentConfig(
      sampleSignal.fingerprintType,
      sampleSignal.componentName,
    );
    if (!config) continue;
    const list = componentScoresByFamily.get(config.family) ?? [];
    list.push({ score: bestSignalScore, reasonCode: bestReasonCode });
    componentScoresByFamily.set(config.family, list);
  }

  const contributions: FamilyContribution[] = [];
  for (const [family, scores] of componentScoresByFamily) {
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    const strongest = sorted[0]?.score ?? 0;
    const second = sorted[1]?.score ?? 0;
    const capped = Math.min(FAMILY_CAPS[family], strongest + second * 0.25);
    if (capped <= 0) continue;
    contributions.push({
      family,
      score: Number(capped.toFixed(4)),
      reasonCodes: sorted.slice(0, 2).map((score) => score.reasonCode),
    });
  }

  return contributions.sort((a, b) => b.score - a.score);
}

function strengthRank(strength: ResponseLinkStrength): number {
  return RESPONSE_LINK_STRENGTHS.indexOf(strength);
}

function maxStrength(
  left: ResponseLinkStrength,
  right: ResponseLinkStrength,
): ResponseLinkStrength {
  return strengthRank(left) >= strengthRank(right) ? left : right;
}

export function evaluateResponsePairLink(
  leftResponse: ResponseLinkAnalysisResponse,
  rightResponse: ResponseLinkAnalysisResponse,
  stats: RarityStats,
): ResponsePairLinkEvaluation {
  const left = buildUsableSignalMap(leftResponse);
  const right = buildUsableSignalMap(rightResponse);
  const familyContributions = calculateFamilyContributions(left, right, stats);
  const deviceEvidence = Number(
    familyContributions
      .reduce((sum, contribution) => sum + contribution.score, 0)
      .toFixed(4),
  );
  const families = new Set(familyContributions.map((item) => item.family));
  const visitorIdMatched = hasMatchingSignal(
    left,
    right,
    (signal) =>
      signal.fingerprintType === "fingerprintjs" &&
      signal.componentName === "visitorId",
  );
  const independentDeviceFamilyCount = [...families].filter(
    (family) => family !== "composite",
  ).length;
  const sessionMatched = Boolean(
    leftResponse.sessionId?.trim() &&
      leftResponse.sessionId.trim() === rightResponse.sessionId?.trim(),
  );
  const respondentMatched = Boolean(
    leftResponse.respondentUuid?.trim() &&
      leftResponse.respondentUuid.trim() ===
        rightResponse.respondentUuid?.trim(),
  );
  const v4Support = hasMatchingSignal(
    left,
    right,
    (signal) =>
      signal.fingerprintType === "telemetry" && signal.componentName === "v4",
  );
  const v6Strong = hasMatchingSignal(
    left,
    right,
    (signal) =>
      signal.fingerprintType === "telemetry" && signal.componentName === "v6",
  );
  const uaSupport = Boolean(
    leftResponse.userAgent?.trim() &&
      leftResponse.userAgent.trim() === rightResponse.userAgent?.trim(),
  );
  const stateSupport = respondentMatched || uaSupport;

  let strength: ResponseLinkStrength = "NONE";
  const reasonCodes: string[] = [];

  if (sessionMatched) {
    strength = "HARD";
    reasonCodes.push("hard:session");
  }
  if (v6Strong) {
    strength = maxStrength(strength, "STRONG");
    reasonCodes.push("strong:telemetry:v6");
  }
  if (
    visitorIdMatched &&
    (independentDeviceFamilyCount > 0 || deviceEvidence >= 2.5)
  ) {
    strength = maxStrength(strength, "STRONG");
    reasonCodes.push("strong:visitorId-with-device-family");
  }
  if (
    respondentMatched &&
    deviceEvidence >= SUPPORT_DEVICE_EVIDENCE_THRESHOLD
  ) {
    strength = maxStrength(strength, "STRONG");
    reasonCodes.push("strong:respondentUuid-with-device");
  }
  if (
    independentDeviceFamilyCount >= 2 &&
    deviceEvidence >= STRONG_DEVICE_EVIDENCE_THRESHOLD
  ) {
    strength = maxStrength(strength, "STRONG");
    reasonCodes.push("strong:multiple-device-families");
  }
  if (strength === "NONE" && visitorIdMatched) {
    strength = "SUPPORT";
    reasonCodes.push("support:visitorId");
  }
  if (
    strength === "NONE" &&
    deviceEvidence >= SUPPORT_DEVICE_EVIDENCE_THRESHOLD
  ) {
    strength = "SUPPORT";
    reasonCodes.push("support:device");
  }
  if (strength === "NONE" && v4Support) {
    strength = "SUPPORT";
    reasonCodes.push("support:telemetry:v4");
  }
  if (strength === "NONE" && uaSupport) {
    strength = "SUPPORT";
    reasonCodes.push("support:userAgent");
  }
  if (strength === "NONE" && respondentMatched) {
    strength = "SUPPORT";
    reasonCodes.push("support:respondentUuid");
  }

  return {
    responseIdA: leftResponse.id,
    responseIdB: rightResponse.id,
    modelVersion: RESPONSE_LINK_MODEL_VERSION,
    strength,
    deviceEvidence,
    familyContributions,
    v4Support,
    v6Strong,
    stateSupport,
    populationSize: stats.populationSize,
    statsVersion: stats.statsVersion,
    reasonCodes,
  };
}

export function buildResponseSuspicionGroups(
  links: ResponsePairLinkEvaluation[],
): ResponseSuspicionGroupEvaluation[] {
  const strongLinks = links.filter(
    (link) => link.strength === "STRONG" || link.strength === "HARD",
  );
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return current;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    parent.set(rootB, rootA);
  };

  for (const link of strongLinks) {
    parent.set(
      link.responseIdA,
      parent.get(link.responseIdA) ?? link.responseIdA,
    );
    parent.set(
      link.responseIdB,
      parent.get(link.responseIdB) ?? link.responseIdB,
    );
    union(link.responseIdA, link.responseIdB);
  }

  const membersByRoot = new Map<string, Set<string>>();
  for (const responseId of parent.keys()) {
    const root = find(responseId);
    const members = membersByRoot.get(root) ?? new Set<string>();
    members.add(responseId);
    membersByRoot.set(root, members);
  }

  const groups: ResponseSuspicionGroupEvaluation[] = [];
  for (const members of membersByRoot.values()) {
    const responseIds = [...members].sort();
    if (responseIds.length < 2) continue;
    const groupLinks = links.filter(
      (link) =>
        members.has(link.responseIdA) &&
        members.has(link.responseIdB) &&
        link.strength !== "NONE",
    );
    const technicalConfidence = groupLinks.reduce<ResponseLinkStrength>(
      (current, link) => maxStrength(current, link.strength),
      "NONE",
    );
    const reasonCodes = [
      ...new Set(groupLinks.flatMap((link) => link.reasonCodes)),
    ].slice(0, 8);
    const topFamilies = groupLinks
      .flatMap((link) => link.familyContributions)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    groups.push({
      groupKey: `group-${hashString(JSON.stringify(responseIds))}`,
      technicalConfidence,
      responseIds,
      strongLinkCount: groupLinks.filter(
        (link) => link.strength === "STRONG" || link.strength === "HARD",
      ).length,
      supportLinkCount: groupLinks.filter((link) => link.strength === "SUPPORT")
        .length,
      summary: { reasonCodes, topFamilies },
    });
  }

  return groups.sort((a, b) => {
    const rankDiff =
      strengthRank(b.technicalConfidence) - strengthRank(a.technicalConfidence);
    if (rankDiff !== 0) return rankDiff;
    return b.responseIds.length - a.responseIds.length;
  });
}
