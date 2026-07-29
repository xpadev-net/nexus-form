import { createHash, randomUUID } from "node:crypto";
import {
  db,
  fingerprintDetail,
  formResponse,
  responseLinkAnalysisRun,
  responsePairLink,
  responseSuspicionGroup,
  responseSuspicionGroupMember,
} from "@nexus-form/database";
import {
  buildRarityStats,
  buildResponseSuspicionGroups,
  evaluateResponsePairLink,
  RESPONSE_LINK_MODEL_VERSION,
  type ResponseLinkAnalysisJobData,
  type ResponseLinkAnalysisResponse,
  type ResponseLinkStrength,
  type ResponsePairLinkEvaluation,
  responseLinkAnalysisJobDataSchema,
} from "@nexus-form/shared";
import type { Job } from "bullmq";
import { and, eq, inArray, sql } from "drizzle-orm";

const CANDIDATE_BUCKET_LIMIT = 200;
const MAX_CANDIDATE_PAIRS = 50_000;

type CandidatePairBuildResult = {
  candidatePairs: Set<string>;
  truncated: boolean;
};

type ResponseRow = {
  id: string;
  sessionId: string | null;
  respondentUuid: string;
  userAgent: string | null;
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function splitPairKey(key: string): [string, string] {
  const [a, b] = key.split("\0");
  if (!a || !b) {
    throw new Error(`Invalid response pair key: ${key}`);
  }
  return [a, b];
}

function stableId(prefix: string, parts: readonly string[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${hash}`;
}

function strengthRank(strength: ResponseLinkStrength): number {
  return ["NONE", "SUPPORT", "STRONG", "HARD"].indexOf(strength);
}

function addBucketPairs(
  candidatePairs: Set<string>,
  responseIds: Iterable<string>,
  options: { bucketLimit?: number } = {},
): boolean {
  const ids = [...new Set(responseIds)].sort();
  if (ids.length < 2) return false;
  if (options.bucketLimit && ids.length > options.bucketLimit) return false;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = ids[i];
      const right = ids[j];
      if (!left || !right) continue;
      if (candidatePairs.size >= MAX_CANDIDATE_PAIRS) {
        return true;
      }
      candidatePairs.add(pairKey(left, right));
    }
  }
  return false;
}

function buildCandidatePairs(
  responses: ResponseLinkAnalysisResponse[],
): CandidatePairBuildResult {
  const candidatePairs = new Set<string>();
  let truncated = false;
  const sessionBuckets = new Map<string, string[]>();
  const respondentBuckets = new Map<string, string[]>();
  const uaBuckets = new Map<string, string[]>();
  const strongSignalBuckets = new Map<string, string[]>();
  const boundedSignalBuckets = new Map<string, string[]>();

  for (const response of responses) {
    const sessionId = response.sessionId?.trim();
    if (sessionId) {
      sessionBuckets.set(sessionId, [
        ...(sessionBuckets.get(sessionId) ?? []),
        response.id,
      ]);
    }
    const respondentUuid = response.respondentUuid?.trim();
    if (respondentUuid) {
      respondentBuckets.set(respondentUuid, [
        ...(respondentBuckets.get(respondentUuid) ?? []),
        response.id,
      ]);
    }
    const userAgent = response.userAgent?.trim();
    if (userAgent) {
      uaBuckets.set(userAgent, [
        ...(uaBuckets.get(userAgent) ?? []),
        response.id,
      ]);
    }

    for (const detail of response.fingerprintDetails) {
      if (!detail.componentValueHash.trim()) continue;
      const isStrongSignal =
        (detail.fingerprintType === "fingerprintjs" &&
          detail.componentName === "visitorId") ||
        (detail.fingerprintType === "telemetry" &&
          detail.componentName === "v6");
      const isBoundedSignal =
        (detail.fingerprintType === "telemetry" &&
          detail.componentName === "v4") ||
        [
          "canvas",
          "fonts",
          "webGlBasics",
          "webgl",
          "system",
          "screen",
        ].includes(detail.componentName);
      if (!isStrongSignal && !isBoundedSignal) continue;
      const key = `${detail.fingerprintType}:${detail.componentName}:${detail.componentValueHash}`;
      const buckets = isStrongSignal
        ? strongSignalBuckets
        : boundedSignalBuckets;
      buckets.set(key, [...(buckets.get(key) ?? []), response.id]);
    }
  }

  for (const buckets of [
    sessionBuckets,
    respondentBuckets,
    strongSignalBuckets,
  ]) {
    for (const responseIds of buckets.values()) {
      truncated = addBucketPairs(candidatePairs, responseIds) || truncated;
      if (truncated) return { candidatePairs, truncated };
    }
  }

  for (const buckets of [boundedSignalBuckets, uaBuckets]) {
    for (const responseIds of buckets.values()) {
      truncated =
        addBucketPairs(candidatePairs, responseIds, {
          bucketLimit: CANDIDATE_BUCKET_LIMIT,
        }) || truncated;
      if (truncated) return { candidatePairs, truncated };
    }
  }

  return { candidatePairs, truncated };
}

async function loadResponses(
  formId: string,
): Promise<ResponseLinkAnalysisResponse[]> {
  const responseRows = await db
    .select({
      id: formResponse.id,
      sessionId: formResponse.sessionId,
      respondentUuid: formResponse.respondentUuid,
      userAgent: formResponse.userAgent,
    })
    .from(formResponse)
    .where(eq(formResponse.formId, formId));

  if (responseRows.length === 0) return [];

  const fingerprints = await db
    .select({
      responseId: fingerprintDetail.responseId,
      fingerprintType: fingerprintDetail.fingerprintType,
      componentName: fingerprintDetail.componentName,
      componentValue: fingerprintDetail.componentValue,
      componentValueHash: fingerprintDetail.componentValueHash,
    })
    .from(fingerprintDetail)
    .where(
      inArray(
        fingerprintDetail.responseId,
        responseRows.map((row) => row.id),
      ),
    );

  const fingerprintsByResponseId = new Map<
    string,
    ResponseLinkAnalysisResponse["fingerprintDetails"]
  >();
  for (const row of fingerprints) {
    const current = fingerprintsByResponseId.get(row.responseId) ?? [];
    current.push(row);
    fingerprintsByResponseId.set(row.responseId, current);
  }

  return responseRows.map((row: ResponseRow) => ({
    id: row.id,
    sessionId: row.sessionId,
    respondentUuid: row.respondentUuid,
    userAgent: row.userAgent,
    fingerprintDetails: fingerprintsByResponseId.get(row.id) ?? [],
  }));
}

async function persistResults(params: {
  formId: string;
  runId: string;
  links: ResponsePairLinkEvaluation[];
  groups: ReturnType<typeof buildResponseSuspicionGroups>;
  metadataJson: Record<string, unknown>;
  statsVersion: string;
  populationSize: number;
}): Promise<void> {
  const {
    formId,
    groups,
    links,
    metadataJson,
    populationSize,
    runId,
    statsVersion,
  } = params;

  await db.transaction(async (tx) => {
    if (links.length > 0) {
      await tx.insert(responsePairLink).values(
        links.map((link) => ({
          id: stableId("response-pair-link", [
            runId,
            link.responseIdA,
            link.responseIdB,
          ]),
          runId,
          formId,
          responseIdA: link.responseIdA,
          responseIdB: link.responseIdB,
          strength: link.strength,
          deviceEvidence: link.deviceEvidence,
          v4Support: link.v4Support,
          v6Strong: link.v6Strong,
          stateSupport: link.stateSupport,
          breakdownJson: {
            modelVersion: link.modelVersion,
            strength: link.strength,
            deviceEvidence: link.deviceEvidence,
            familyContributions: link.familyContributions,
            v4Support: link.v4Support,
            v6Strong: link.v6Strong,
            stateSupport: link.stateSupport,
            populationSize: link.populationSize,
            statsVersion: link.statsVersion,
            reasonCodes: link.reasonCodes,
          },
        })),
      );
    }

    for (const group of groups) {
      const groupId = stableId("response-suspicion-group", [
        runId,
        group.groupKey,
      ]);
      await tx.insert(responseSuspicionGroup).values({
        id: groupId,
        runId,
        formId,
        groupKey: group.groupKey,
        technicalConfidence: group.technicalConfidence,
        responseCount: group.responseIds.length,
        strongLinkCount: group.strongLinkCount,
        supportLinkCount: group.supportLinkCount,
        summaryJson: group.summary,
      });

      const memberRows = group.responseIds.map((responseId) => {
        const memberLinks = links.filter(
          (link) =>
            link.responseIdA === responseId || link.responseIdB === responseId,
        );
        const strongest = memberLinks.reduce<ResponseLinkStrength>(
          (current, link) =>
            strengthRank(link.strength) > strengthRank(current)
              ? link.strength
              : current,
          "NONE",
        );
        const strongestEvidence = Math.max(
          0,
          ...memberLinks.map((link) => link.deviceEvidence),
        );
        return {
          id: stableId("response-suspicion-group-member", [
            groupId,
            responseId,
          ]),
          runId,
          groupId,
          responseId,
          strongestStrength: strongest,
          strongestEvidence,
        };
      });
      if (memberRows.length > 0) {
        await tx.insert(responseSuspicionGroupMember).values(memberRows);
      }
    }

    await tx
      .update(responseLinkAnalysisRun)
      .set({
        status: "COMPLETED",
        statsVersion,
        populationSize,
        metadataJson,
        completedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(responseLinkAnalysisRun.id, runId));
  });
}

export async function analyzeResponseLinks(formId: string): Promise<{
  runId: string;
  linkCount: number;
  groupCount: number;
}> {
  const runId = randomUUID();
  await db.insert(responseLinkAnalysisRun).values({
    id: runId,
    formId,
    modelVersion: RESPONSE_LINK_MODEL_VERSION,
    status: "PROCESSING",
    populationSize: 0,
  });

  try {
    const responses = await loadResponses(formId);
    const stats = buildRarityStats(responses);
    const responsesById = new Map(
      responses.map((response) => [response.id, response]),
    );
    const { candidatePairs, truncated } = buildCandidatePairs(responses);
    const links: ResponsePairLinkEvaluation[] = [];

    for (const key of candidatePairs) {
      const [leftId, rightId] = splitPairKey(key);
      const left = responsesById.get(leftId);
      const right = responsesById.get(rightId);
      if (!left || !right) continue;
      const link = evaluateResponsePairLink(left, right, stats);
      if (link.strength === "NONE") continue;
      links.push(link);
    }

    const groups = buildResponseSuspicionGroups(links);
    await persistResults({
      formId,
      runId,
      links,
      groups,
      metadataJson: {
        candidatePairCount: candidatePairs.size,
        candidatePairLimit: MAX_CANDIDATE_PAIRS,
        candidatePairsTruncated: truncated,
      },
      statsVersion: stats.statsVersion,
      populationSize: stats.populationSize,
    });
    return { runId, linkCount: links.length, groupCount: groups.length };
  } catch (error) {
    await db
      .update(responseLinkAnalysisRun)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(responseLinkAnalysisRun.id, runId));
    throw error;
  }
}

export async function handleResponseLinkAnalysis(
  job: Job<ResponseLinkAnalysisJobData>,
): Promise<{ runId: string; linkCount: number; groupCount: number }> {
  const data = responseLinkAnalysisJobDataSchema.parse(job.data);

  await db
    .update(responseLinkAnalysisRun)
    .set({ status: "STALE" })
    .where(
      and(
        eq(responseLinkAnalysisRun.formId, data.formId),
        eq(responseLinkAnalysisRun.modelVersion, RESPONSE_LINK_MODEL_VERSION),
        eq(responseLinkAnalysisRun.status, "COMPLETED"),
        sql`${responseLinkAnalysisRun.completedAt} < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      ),
    );

  return analyzeResponseLinks(data.formId);
}
