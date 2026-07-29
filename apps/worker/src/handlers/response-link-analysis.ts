import { createHash, randomUUID } from "node:crypto";
import {
  db,
  fingerprintDetail,
  formResponse,
  responseLinkAnalysisLock,
  responseLinkAnalysisRun,
  responsePairLink,
  responseSuspicionGroup,
  responseSuspicionGroupMember,
} from "@nexus-form/database";
import {
  addJobWithCleanup,
  buildRarityStats,
  buildResponseLinkAnalysisJobId,
  buildResponseSuspicionGroups,
  evaluateResponsePairLink,
  getResponseLinkAnalysisDirtyKey,
  RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
  RESPONSE_LINK_ANALYSIS_QUEUE,
  RESPONSE_LINK_MODEL_VERSION,
  type ResponseLinkAnalysisJobData,
  type ResponseLinkAnalysisResponse,
  type ResponseLinkStrength,
  type ResponsePairLinkEvaluation,
  responseLinkAnalysisJobDataSchema,
} from "@nexus-form/shared";
import { type DefaultJobOptions, type Job, Queue } from "bullmq";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Redis from "ioredis";
import { getPublisherConnectionOptions, redisConnection } from "../lib/redis";

const CANDIDATE_BUCKET_LIMIT = 200;
const DEFAULT_ANALYSIS_RESPONSE_LIMIT = 5000;
const DEFAULT_MAX_CANDIDATE_PAIRS = 50_000;
const FINGERPRINT_RESPONSE_ID_BATCH_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;
const LOCK_ACQUIRE_TIMEOUT_MS = 30 * 60_000;
const LOCK_HEARTBEAT_INTERVAL_MS = 60_000;
const LOCK_RETRY_DELAY_MS = 30_000;
const RESPONSE_LINK_ANALYSIS_JOB_DEFAULTS: DefaultJobOptions = {
  attempts: 2,
  backoff: {
    type: "exponential",
    delay: 60_000,
  },
  removeOnComplete: 100,
  removeOnFail: 100,
};

type CandidatePairBuildResult = {
  candidatePairs: Set<string>;
  skippedBucketCount: number;
  truncated: boolean;
};

type BucketPairAddResult = {
  skippedBucketCount: number;
  truncated: boolean;
};

class CandidatePairLimitExceededError extends Error {
  constructor(candidatePairLimit: number, skippedBucketCount: number) {
    super(
      `Response link analysis exceeded candidate pair limit ${candidatePairLimit} and skipped ${skippedBucketCount} candidate bucket(s)`,
    );
    this.name = "CandidatePairLimitExceededError";
  }
}

type ResponseRow = {
  id: string;
  sessionId: string | null;
  respondentUuid: string;
  userAgent: string | null;
};

let responseLinkAnalysisQueue: Queue<ResponseLinkAnalysisJobData> | null = null;
let responseLinkAnalysisDirtyClient: Redis | null = null;

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "ER_DUP_ENTRY" || record.errno === 1062;
}

function affectedRows(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  if (Array.isArray(result)) return affectedRows(result[0]);
  const value = (result as Record<string, unknown>).affectedRows;
  return typeof value === "number" ? value : null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error("Response link analysis aborted");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getResponseLinkAnalysisQueue(): Queue<ResponseLinkAnalysisJobData> {
  responseLinkAnalysisQueue ??= new Queue<ResponseLinkAnalysisJobData>(
    RESPONSE_LINK_ANALYSIS_QUEUE,
    {
      connection: redisConnection,
      defaultJobOptions: RESPONSE_LINK_ANALYSIS_JOB_DEFAULTS,
    },
  );
  return responseLinkAnalysisQueue;
}

function getResponseLinkAnalysisDirtyClient(): Redis {
  responseLinkAnalysisDirtyClient ??= new Redis(
    getPublisherConnectionOptions(),
  );
  return responseLinkAnalysisDirtyClient;
}

export async function closeResponseLinkAnalysisResources(): Promise<void> {
  const queue = responseLinkAnalysisQueue;
  const dirtyClient = responseLinkAnalysisDirtyClient;
  responseLinkAnalysisQueue = null;
  responseLinkAnalysisDirtyClient = null;
  await Promise.all([queue?.close(), dirtyClient?.quit()]);
}

function isResponseLinkAnalysisDirtyJob(
  formId: string,
  jobId: string,
): boolean {
  return jobId.startsWith(`${buildResponseLinkAnalysisJobId(formId)}.dirty.`);
}

async function consumeResponseLinkAnalysisDirty(
  formId: string,
): Promise<boolean> {
  const deleted = await getResponseLinkAnalysisDirtyClient().del(
    getResponseLinkAnalysisDirtyKey(formId),
  );
  return deleted > 0;
}

async function enqueueDirtyResponseLinkFollowUp(formId: string): Promise<void> {
  await addJobWithCleanup(getResponseLinkAnalysisQueue(), {
    delay: RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
    jobData: { formId, reason: "response-submitted" },
    jobId: buildResponseLinkAnalysisJobId(formId, "follow-up"),
    jobName: "response-submitted",
  });
}

async function acquireFormAnalysisLock(
  formId: string,
  jobId: string,
): Promise<void> {
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  do {
    await db
      .delete(responseLinkAnalysisLock)
      .where(
        and(
          eq(responseLinkAnalysisLock.formId, formId),
          sql`${responseLinkAnalysisLock.lockedAt} < DATE_SUB(NOW(), INTERVAL 2 HOUR)`,
        ),
      );

    try {
      await db.insert(responseLinkAnalysisLock).values({ formId, jobId });
      return;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for response link analysis lock for form ${formId}`,
        );
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  } while (Date.now() < deadline);

  throw new Error(
    `Timed out waiting for response link analysis lock for form ${formId}`,
  );
}

async function withFormAnalysisLock<T>(
  formId: string,
  jobId: string,
  callback: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  await acquireFormAnalysisLock(formId, jobId);
  const abortController = new AbortController();

  const heartbeat = setInterval(() => {
    void db
      .update(responseLinkAnalysisLock)
      .set({ lockedAt: new Date() })
      .where(
        and(
          eq(responseLinkAnalysisLock.formId, formId),
          eq(responseLinkAnalysisLock.jobId, jobId),
        ),
      )
      .then((result) => {
        if (affectedRows(result) === 0) {
          abortController.abort(
            new Error(`Lost response link analysis lock for form ${formId}`),
          );
        }
      })
      .catch((error: unknown) => {
        console.warn(
          "[response-link-analysis] Failed to refresh form analysis lock",
          error,
        );
        abortController.abort(
          error instanceof Error
            ? error
            : new Error("Failed to refresh response link analysis lock"),
        );
      });
  }, LOCK_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    return await callback(abortController.signal);
  } finally {
    clearInterval(heartbeat);
    await db
      .delete(responseLinkAnalysisLock)
      .where(
        and(
          eq(responseLinkAnalysisLock.formId, formId),
          eq(responseLinkAnalysisLock.jobId, jobId),
        ),
      );
  }
}

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

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function addBucketPairs(
  candidatePairs: Set<string>,
  responseIds: Iterable<string>,
  options: { bucketLimit?: number; maxCandidatePairs: number },
): BucketPairAddResult {
  const ids = [...new Set(responseIds)].sort();
  if (ids.length < 2) return { skippedBucketCount: 0, truncated: false };
  if (options.bucketLimit !== undefined && ids.length > options.bucketLimit) {
    return { skippedBucketCount: 1, truncated: false };
  }
  const pairCount = (ids.length * (ids.length - 1)) / 2;
  if (candidatePairs.size + pairCount > options.maxCandidatePairs) {
    return { skippedBucketCount: 1, truncated: true };
  }
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = ids[i];
      const right = ids[j];
      if (!left || !right) continue;
      candidatePairs.add(pairKey(left, right));
    }
  }
  return { skippedBucketCount: 0, truncated: false };
}

function pushBucketValue(
  buckets: Map<string, string[]>,
  key: string,
  responseId: string,
): void {
  const existing = buckets.get(key);
  if (existing) {
    existing.push(responseId);
    return;
  }
  buckets.set(key, [responseId]);
}

function pushLinkValue(
  linksByResponseId: Map<string, ResponsePairLinkEvaluation[]>,
  responseId: string,
  link: ResponsePairLinkEvaluation,
): void {
  const existing = linksByResponseId.get(responseId);
  if (existing) {
    existing.push(link);
    return;
  }
  linksByResponseId.set(responseId, [link]);
}

function buildCandidatePairs(
  responses: ResponseLinkAnalysisResponse[],
  maxCandidatePairs: number,
): CandidatePairBuildResult {
  const candidatePairs = new Set<string>();
  let skippedBucketCount = 0;
  let truncated = false;
  const sessionBuckets = new Map<string, string[]>();
  const respondentBuckets = new Map<string, string[]>();
  const uaBuckets = new Map<string, string[]>();
  const strongSignalBuckets = new Map<string, string[]>();
  const boundedSignalBuckets = new Map<string, string[]>();

  for (const response of responses) {
    const sessionId = response.sessionId?.trim();
    if (sessionId) {
      pushBucketValue(sessionBuckets, sessionId, response.id);
    }
    const respondentUuid = response.respondentUuid?.trim();
    if (respondentUuid) {
      pushBucketValue(respondentBuckets, respondentUuid, response.id);
    }
    const userAgent = response.userAgent?.trim();
    if (userAgent) {
      pushBucketValue(uaBuckets, userAgent, response.id);
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
      pushBucketValue(buckets, key, response.id);
    }
  }

  for (const buckets of [
    sessionBuckets,
    respondentBuckets,
    strongSignalBuckets,
  ]) {
    for (const responseIds of buckets.values()) {
      const result = addBucketPairs(candidatePairs, responseIds, {
        maxCandidatePairs,
      });
      skippedBucketCount += result.skippedBucketCount;
      truncated = result.truncated || truncated;
    }
  }

  for (const buckets of [boundedSignalBuckets, uaBuckets]) {
    for (const responseIds of buckets.values()) {
      const result = addBucketPairs(candidatePairs, responseIds, {
        bucketLimit: CANDIDATE_BUCKET_LIMIT,
        maxCandidatePairs,
      });
      skippedBucketCount += result.skippedBucketCount;
      truncated = result.truncated || truncated;
    }
  }

  return { candidatePairs, skippedBucketCount, truncated };
}

async function loadResponses(
  formId: string,
  maxResponses: number,
  signal?: AbortSignal,
): Promise<{ responses: ResponseLinkAnalysisResponse[]; truncated: boolean }> {
  throwIfAborted(signal);
  const responseRows = await db
    .select({
      id: formResponse.id,
      sessionId: formResponse.sessionId,
      respondentUuid: formResponse.respondentUuid,
      userAgent: formResponse.userAgent,
    })
    .from(formResponse)
    .where(eq(formResponse.formId, formId))
    .orderBy(desc(formResponse.submittedAt))
    .limit(maxResponses + 1);

  const truncated = responseRows.length > maxResponses;
  const retainedRows = responseRows.slice(0, maxResponses);

  if (retainedRows.length === 0) return { responses: [], truncated };

  const fingerprints: Array<{
    responseId: string;
    fingerprintType: string;
    componentName: string;
    componentValue: string | null;
    componentValueHash: string;
  }> = [];
  for (const responseIdBatch of chunks(
    retainedRows.map((row) => row.id),
    FINGERPRINT_RESPONSE_ID_BATCH_SIZE,
  )) {
    throwIfAborted(signal);
    const batchRows = await db
      .select({
        responseId: fingerprintDetail.responseId,
        fingerprintType: fingerprintDetail.fingerprintType,
        componentName: fingerprintDetail.componentName,
        componentValue: fingerprintDetail.componentValue,
        componentValueHash: fingerprintDetail.componentValueHash,
      })
      .from(fingerprintDetail)
      .where(inArray(fingerprintDetail.responseId, responseIdBatch));
    fingerprints.push(...batchRows);
  }
  throwIfAborted(signal);

  const fingerprintsByResponseId = new Map<
    string,
    ResponseLinkAnalysisResponse["fingerprintDetails"]
  >();
  for (const row of fingerprints) {
    const current = fingerprintsByResponseId.get(row.responseId) ?? [];
    current.push(row);
    fingerprintsByResponseId.set(row.responseId, current);
  }

  return {
    responses: retainedRows.map((row: ResponseRow) => ({
      id: row.id,
      sessionId: row.sessionId,
      respondentUuid: row.respondentUuid,
      userAgent: row.userAgent,
      fingerprintDetails: fingerprintsByResponseId.get(row.id) ?? [],
    })),
    truncated,
  };
}

async function persistResults(params: {
  formId: string;
  runId: string;
  links: ResponsePairLinkEvaluation[];
  groups: ReturnType<typeof buildResponseSuspicionGroups>;
  metadataJson: Record<string, unknown>;
  signal?: AbortSignal;
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
    signal,
    statsVersion,
  } = params;

  await db.transaction(async (tx) => {
    throwIfAborted(signal);
    const linksByResponseId = new Map<string, ResponsePairLinkEvaluation[]>();
    for (const link of links) {
      pushLinkValue(linksByResponseId, link.responseIdA, link);
      pushLinkValue(linksByResponseId, link.responseIdB, link);
    }

    if (links.length > 0) {
      const rows = links.map((link) => ({
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
      }));
      for (const chunk of chunks(rows, INSERT_CHUNK_SIZE)) {
        throwIfAborted(signal);
        await tx.insert(responsePairLink).values(chunk);
      }
    }

    for (const group of groups) {
      throwIfAborted(signal);
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
        const memberLinks = linksByResponseId.get(responseId) ?? [];
        const strongest = memberLinks.reduce<ResponseLinkStrength>(
          (current, link) =>
            strengthRank(link.strength) > strengthRank(current)
              ? link.strength
              : current,
          "NONE",
        );
        const strongestEvidence = memberLinks.reduce(
          (current, link) => Math.max(current, link.deviceEvidence),
          0,
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
        for (const chunk of chunks(memberRows, INSERT_CHUNK_SIZE)) {
          throwIfAborted(signal);
          await tx.insert(responseSuspicionGroupMember).values(chunk);
        }
      }
    }

    throwIfAborted(signal);
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
      .where(
        and(
          eq(responseLinkAnalysisRun.id, runId),
          eq(responseLinkAnalysisRun.status, "PROCESSING"),
        ),
      );
  });
}

/**
 * Builds and persists response-link shadow results for one form.
 *
 * Candidate generation is capped by `maxCandidatePairs`. Oversized popular
 * buckets are skipped and reported in completed-run metadata; exceeding the
 * global pair cap fails the run instead of persisting incomplete links/groups.
 */
export async function analyzeResponseLinks(
  formId: string,
  options: { maxCandidatePairs?: number; signal?: AbortSignal } = {},
): Promise<{
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
    throwIfAborted(options.signal);
    const { responses, truncated: responsePopulationTruncated } =
      await loadResponses(
        formId,
        DEFAULT_ANALYSIS_RESPONSE_LIMIT,
        options.signal,
      );
    throwIfAborted(options.signal);
    const stats = buildRarityStats(responses);
    const responsesById = new Map(
      responses.map((response) => [response.id, response]),
    );
    const maxCandidatePairs =
      options.maxCandidatePairs ?? DEFAULT_MAX_CANDIDATE_PAIRS;
    const { candidatePairs, skippedBucketCount, truncated } =
      buildCandidatePairs(responses, maxCandidatePairs);
    if (truncated) {
      throw new CandidatePairLimitExceededError(
        maxCandidatePairs,
        skippedBucketCount,
      );
    }
    const links: ResponsePairLinkEvaluation[] = [];

    let processedCandidatePairCount = 0;
    for (const key of candidatePairs) {
      if (processedCandidatePairCount % INSERT_CHUNK_SIZE === 0) {
        throwIfAborted(options.signal);
      }
      processedCandidatePairCount += 1;
      const [leftId, rightId] = splitPairKey(key);
      const left = responsesById.get(leftId);
      const right = responsesById.get(rightId);
      if (!left || !right) continue;
      const link = evaluateResponsePairLink(left, right, stats);
      if (link.strength === "NONE") continue;
      links.push(link);
    }

    throwIfAborted(options.signal);
    const groups = buildResponseSuspicionGroups(links);
    await persistResults({
      formId,
      runId,
      links,
      groups,
      metadataJson: {
        candidatePairLimitExceeded: truncated,
        candidatePairCount: candidatePairs.size,
        candidatePairLimit: maxCandidatePairs,
        responsePopulationLimit: DEFAULT_ANALYSIS_RESPONSE_LIMIT,
        responsePopulationTruncated,
        skippedCandidateBucketCount: skippedBucketCount,
      },
      signal: options.signal,
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
      .where(
        and(
          eq(responseLinkAnalysisRun.id, runId),
          eq(responseLinkAnalysisRun.status, "PROCESSING"),
        ),
      );
    throw error;
  }
}

/**
 * BullMQ handler for response-link shadow analysis.
 *
 * The handler serializes work per form with a database lock, purges old stale
 * runs before analysis, and lets failures propagate so BullMQ retry policy can
 * run. Dirty rescue jobs only analyze when they can consume a dirty marker at
 * start; stale dirty jobs no-op so coalesced rescue jobs do not multiply full
 * analyses after another worker has already consumed the marker. If API
 * enqueueing marks the form dirty during analysis, a fixed follow-up job is
 * scheduled after the lock is released.
 */
export async function handleResponseLinkAnalysis(
  job: Job<ResponseLinkAnalysisJobData>,
): Promise<{ runId: string; linkCount: number; groupCount: number }> {
  const data = responseLinkAnalysisJobDataSchema.parse(job.data);
  const jobId = job.id ?? stableId("job", [data.formId]);
  const isDirtyJob = isResponseLinkAnalysisDirtyJob(data.formId, jobId);

  const result = await withFormAnalysisLock(
    data.formId,
    jobId,
    async (signal) => {
      await db
        .update(responseLinkAnalysisRun)
        .set({ status: "STALE" })
        .where(
          and(
            eq(responseLinkAnalysisRun.formId, data.formId),
            eq(
              responseLinkAnalysisRun.modelVersion,
              RESPONSE_LINK_MODEL_VERSION,
            ),
            eq(responseLinkAnalysisRun.status, "COMPLETED"),
            sql`${responseLinkAnalysisRun.completedAt} < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
          ),
        );

      const staleRuns = await db
        .select({ id: responseLinkAnalysisRun.id })
        .from(responseLinkAnalysisRun)
        .where(
          and(
            eq(responseLinkAnalysisRun.formId, data.formId),
            eq(
              responseLinkAnalysisRun.modelVersion,
              RESPONSE_LINK_MODEL_VERSION,
            ),
            eq(responseLinkAnalysisRun.status, "STALE"),
          ),
        );
      const staleRunIds = staleRuns.map((run) => run.id);
      for (const staleRunIdChunk of chunks(staleRunIds, INSERT_CHUNK_SIZE)) {
        await db
          .delete(responseSuspicionGroupMember)
          .where(inArray(responseSuspicionGroupMember.runId, staleRunIdChunk));
        await db
          .delete(responsePairLink)
          .where(inArray(responsePairLink.runId, staleRunIdChunk));
        await db
          .delete(responseSuspicionGroup)
          .where(inArray(responseSuspicionGroup.runId, staleRunIdChunk));
        await db
          .delete(responseLinkAnalysisRun)
          .where(inArray(responseLinkAnalysisRun.id, staleRunIdChunk));
      }

      const consumedDirtyMarker = await consumeResponseLinkAnalysisDirty(
        data.formId,
      );
      if (isDirtyJob && !consumedDirtyMarker) {
        throwIfAborted(signal);
        return { runId: "", linkCount: 0, groupCount: 0 };
      }
      throwIfAborted(signal);
      return analyzeResponseLinks(data.formId, { signal });
    },
  );
  if (await consumeResponseLinkAnalysisDirty(data.formId)) {
    await enqueueDirtyResponseLinkFollowUp(data.formId);
  }
  return result;
}
