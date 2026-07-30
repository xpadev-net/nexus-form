import { randomUUID } from "node:crypto";
import {
  addJobWithCleanup,
  buildResponseLinkAnalysisDirtyJobId,
  buildResponseLinkAnalysisJobId,
  FORM_SUBMIT_NOTIFICATION_QUEUE,
  getResponseLinkAnalysisDirtyKey,
  RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
  RESPONSE_LINK_ANALYSIS_DIRTY_TTL_SECONDS,
  RESPONSE_LINK_ANALYSIS_QUEUE,
  responseLinkAnalysisJobDataSchema,
} from "@nexus-form/shared";
import { type DefaultJobOptions, Queue } from "bullmq";
import Redis from "ioredis";
import { getRedisConnection } from "./redis";

const JOB_RETENTION_DEFAULTS = {
  removeOnComplete: 100,
  removeOnFail: 100,
} satisfies Pick<DefaultJobOptions, "removeOnComplete" | "removeOnFail">;

/**
 * 動的プロバイダー対応のリトライバックオフ設定
 * [30秒, 2分, 5分] の明示的バックオフ
 */
const VALIDATION_JOB_DEFAULTS: DefaultJobOptions = {
  ...JOB_RETENTION_DEFAULTS,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30_000,
  },
};

const STANDARD_QUEUE_RETRY_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30_000,
  },
} satisfies Pick<DefaultJobOptions, "attempts" | "backoff">;

const SHEETS_JOB_DEFAULTS: DefaultJobOptions = {
  ...JOB_RETENTION_DEFAULTS,
  ...STANDARD_QUEUE_RETRY_JOB_OPTIONS,
};

const NOTIFICATION_JOB_DEFAULTS: DefaultJobOptions = {
  ...JOB_RETENTION_DEFAULTS,
  ...STANDARD_QUEUE_RETRY_JOB_OPTIONS,
};

const RESPONSE_LINK_ANALYSIS_JOB_DEFAULTS: DefaultJobOptions = {
  ...JOB_RETENTION_DEFAULTS,
  attempts: 2,
  backoff: {
    type: "exponential",
    delay: 60_000,
  },
};

export const SHEETS_SYNC_MANUAL_RETRY_JOB_OPTIONS =
  STANDARD_QUEUE_RETRY_JOB_OPTIONS;

let _sheetsSyncQueue: Queue | null = null;
let _formSubmitNotificationQueue: Queue | null = null;
let _responseLinkAnalysisQueue: Queue | null = null;
let _responseLinkAnalysisDirtyClient: Redis | null = null;

const _validationQueues: Map<string, Queue> = new Map();

/**
 * キュー名からキューを取得する
 * 組み込みプロバイダーは事前に作成され、
 * 動的プロバイダーは初めてアクセスされた時に作成される
 */
export function getValidationQueue(serviceName: string): Queue {
  if (!isValidServiceName(serviceName)) {
    throw new Error(`Invalid service name: ${serviceName}`);
  }

  const cached = _validationQueues.get(serviceName);
  if (cached) {
    return cached;
  }

  const { connection } = getRedisConnection();
  const queue = new Queue(`${serviceName}-validation`, {
    connection,
    defaultJobOptions: VALIDATION_JOB_DEFAULTS,
  });
  _validationQueues.set(serviceName, queue);
  return queue;
}

/**
 * 有効なサービス名かどうかチェックする
 */
export function isValidServiceName(serviceName: string): boolean {
  return serviceName.length <= 64 && /^[a-z][a-z0-9_]*$/.test(serviceName);
}

export function getSheetsSyncQueue(): Queue {
  if (!_sheetsSyncQueue) {
    const { connection } = getRedisConnection();
    _sheetsSyncQueue = new Queue("google-sheets-sync", {
      connection,
      defaultJobOptions: SHEETS_JOB_DEFAULTS,
    });
  }
  return _sheetsSyncQueue;
}

export function getFormSubmitNotificationQueue(): Queue {
  if (!_formSubmitNotificationQueue) {
    const { connection } = getRedisConnection();
    _formSubmitNotificationQueue = new Queue(FORM_SUBMIT_NOTIFICATION_QUEUE, {
      connection,
      defaultJobOptions: NOTIFICATION_JOB_DEFAULTS,
    });
  }
  return _formSubmitNotificationQueue;
}

export function getResponseLinkAnalysisQueue(): Queue {
  if (!_responseLinkAnalysisQueue) {
    const { connection } = getRedisConnection();
    _responseLinkAnalysisQueue = new Queue(RESPONSE_LINK_ANALYSIS_QUEUE, {
      connection,
      defaultJobOptions: RESPONSE_LINK_ANALYSIS_JOB_DEFAULTS,
    });
  }
  return _responseLinkAnalysisQueue;
}

function isRunningOrPendingJobState(state: unknown): boolean {
  return state !== "completed" && state !== "failed" && state !== undefined;
}

function isActiveJobState(state: unknown): boolean {
  return state === "active" || state === "waiting-children";
}

function getResponseLinkAnalysisDirtyClient(): Redis {
  if (!_responseLinkAnalysisDirtyClient) {
    _responseLinkAnalysisDirtyClient = new Redis(
      getRedisConnection().connection,
    );
  }
  return _responseLinkAnalysisDirtyClient;
}

async function markResponseLinkAnalysisDirty(
  queue: Queue,
  jobData: {
    formId: string;
    reason: "response-submitted" | "response-deleted" | "manual";
  },
): Promise<void> {
  await getResponseLinkAnalysisDirtyClient().set(
    getResponseLinkAnalysisDirtyKey(jobData.formId),
    randomUUID(),
    "EX",
    RESPONSE_LINK_ANALYSIS_DIRTY_TTL_SECONDS,
  );
  await addJobWithCleanup(queue, {
    delay: RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
    jobData,
    jobId: buildResponseLinkAnalysisDirtyJobId(jobData.formId),
    jobName: jobData.reason,
  });
}

/**
 * Enqueues shadow response-link analysis for a form.
 *
 * Mutations normally coalesce into a stable primary job. If that job is already
 * active, one stable follow-up is scheduled; if primary and follow-up are both
 * active, one stable overflow is scheduled. When all three slots are already
 * active, the mutation is recorded as a dirty marker and a coalesced dirty job
 * is scheduled for the next time bucket so a later worker remains available to
 * consume markers written during the final active-handler return race.
 */
export type ResponseLinkAnalysisEnqueueOutcome =
  | "enqueued"
  | "coalesced"
  | "dirty";

export type ResponseLinkAnalysisEnqueueResult = {
  enqueued: boolean;
  status: ResponseLinkAnalysisEnqueueOutcome;
};

export async function enqueueResponseLinkAnalysisJob(params: {
  formId: string;
  reason: "response-submitted" | "response-deleted" | "manual";
}): Promise<ResponseLinkAnalysisEnqueueResult> {
  const jobData = responseLinkAnalysisJobDataSchema.parse(params);
  const queue = getResponseLinkAnalysisQueue();
  const primaryJobId = buildResponseLinkAnalysisJobId(params.formId);
  const followUpJobId = buildResponseLinkAnalysisJobId(
    params.formId,
    "follow-up",
  );
  const overflowJobId = buildResponseLinkAnalysisJobId(
    params.formId,
    "overflow",
  );
  let overflowState: unknown;
  const primaryJob = await queue.getJob(primaryJobId);
  const primaryState = await primaryJob?.getState();
  const followUpJob = await queue.getJob(followUpJobId);
  const followUpState = await followUpJob?.getState();
  let jobId = primaryJobId;
  if (isActiveJobState(primaryState) && isActiveJobState(followUpState)) {
    const overflowJob = await queue.getJob(overflowJobId);
    overflowState = await overflowJob?.getState();
    if (isActiveJobState(overflowState)) {
      await markResponseLinkAnalysisDirty(queue, jobData);
      return { enqueued: false, status: "dirty" };
    }
    jobId = overflowJobId;
  } else if (isActiveJobState(followUpState)) {
    jobId = primaryJobId;
  } else if (
    isRunningOrPendingJobState(followUpState) ||
    isActiveJobState(primaryState)
  ) {
    jobId = followUpJobId;
  }

  const enqueueWithJobId = (targetJobId: string) =>
    addJobWithCleanup(queue, {
      delay: RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
      jobData,
      jobId: targetJobId,
      jobName: params.reason,
    });
  const enqueueOverflowOrDirty =
    async (): Promise<ResponseLinkAnalysisEnqueueResult> => {
      const currentOverflowJob = await queue.getJob(overflowJobId);
      overflowState = await currentOverflowJob?.getState();
      if (isRunningOrPendingJobState(overflowState)) {
        await markResponseLinkAnalysisDirty(queue, jobData);
        return { enqueued: false, status: "dirty" };
      }
      const overflowResult = await enqueueWithJobId(overflowJobId);
      if (overflowResult.outcome === "delayed-job-state-changed") {
        await markResponseLinkAnalysisDirty(queue, jobData);
        return { enqueued: false, status: "dirty" };
      }
      return { enqueued: true, status: "enqueued" };
    };
  const stateForJobId = (targetJobId: string): unknown => {
    if (targetJobId === primaryJobId) return primaryState;
    if (targetJobId === followUpJobId) return followUpState;
    return overflowState;
  };
  const resultForJobId = (
    targetJobId: string,
  ): ResponseLinkAnalysisEnqueueResult =>
    isRunningOrPendingJobState(stateForJobId(targetJobId))
      ? { enqueued: false, status: "coalesced" }
      : { enqueued: true, status: "enqueued" };

  const result = await enqueueWithJobId(jobId);
  if (result.outcome !== "delayed-job-state-changed") {
    return resultForJobId(jobId);
  }

  if (jobId === overflowJobId) {
    await markResponseLinkAnalysisDirty(queue, jobData);
    return { enqueued: false, status: "dirty" };
  }

  const fallbackJobId = jobId === primaryJobId ? followUpJobId : primaryJobId;
  if (isRunningOrPendingJobState(stateForJobId(fallbackJobId))) {
    return enqueueOverflowOrDirty();
  }
  const fallbackResult = await enqueueWithJobId(fallbackJobId);
  if (fallbackResult.outcome === "delayed-job-state-changed") {
    return enqueueOverflowOrDirty();
  }
  return resultForJobId(fallbackJobId);
}

export async function closeQueues(): Promise<void> {
  const queues = [
    ..._validationQueues.values(),
    ...(_sheetsSyncQueue ? [_sheetsSyncQueue] : []),
    ...(_formSubmitNotificationQueue ? [_formSubmitNotificationQueue] : []),
    ...(_responseLinkAnalysisQueue ? [_responseLinkAnalysisQueue] : []),
  ];
  try {
    await Promise.all(queues.map((queue) => queue.close()));
  } finally {
    _validationQueues.clear();
    _sheetsSyncQueue = null;
    _formSubmitNotificationQueue = null;
    _responseLinkAnalysisQueue = null;
    await _responseLinkAnalysisDirtyClient?.quit();
    _responseLinkAnalysisDirtyClient = null;
  }
}
