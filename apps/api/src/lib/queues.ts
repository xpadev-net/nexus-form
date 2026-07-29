import {
  addJobWithCleanup,
  FORM_SUBMIT_NOTIFICATION_QUEUE,
  RESPONSE_LINK_ANALYSIS_QUEUE,
  responseLinkAnalysisJobDataSchema,
} from "@nexus-form/shared";
import { type DefaultJobOptions, Queue } from "bullmq";
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

const RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS = 10_000;

export const SHEETS_SYNC_MANUAL_RETRY_JOB_OPTIONS =
  STANDARD_QUEUE_RETRY_JOB_OPTIONS;

let _sheetsSyncQueue: Queue | null = null;
let _formSubmitNotificationQueue: Queue | null = null;
let _responseLinkAnalysisQueue: Queue | null = null;

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

export async function enqueueResponseLinkAnalysisJob(params: {
  formId: string;
  reason: "response-submitted" | "response-deleted" | "manual";
}): Promise<void> {
  const jobData = responseLinkAnalysisJobDataSchema.parse(params);
  const queue = getResponseLinkAnalysisQueue();
  const primaryJobId = `response-link-analysis.${params.formId}`;
  const followUpJobId = `${primaryJobId}.follow-up`;
  const primaryJob = await queue.getJob(primaryJobId);
  const primaryState = await primaryJob?.getState();
  const followUpJob = await queue.getJob(followUpJobId);
  const followUpState = await followUpJob?.getState();
  const jobId =
    isRunningOrPendingJobState(followUpState) ||
    primaryState === "active" ||
    primaryState === "waiting-children"
      ? followUpJobId
      : primaryJobId;

  await addJobWithCleanup(queue, {
    delay: RESPONSE_LINK_ANALYSIS_COALESCE_DELAY_MS,
    jobData,
    jobId,
    jobName: params.reason,
  });
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
  }
}
