import { type DefaultJobOptions, Queue } from "bullmq";
import { getRedisConnection } from "./redis";

/**
 * 動的プロバイダー対応のリトライバックオフ設定
 * [30秒, 2分, 5分] の明示的バックオフ
 */
const VALIDATION_JOB_DEFAULTS: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30_000,
  },
};

const SHEETS_JOB_DEFAULTS: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30_000,
  },
};

let _sheetsSyncQueue: Queue | null = null;

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

export async function closeQueues(): Promise<void> {
  const queues = [
    ..._validationQueues.values(),
    ...(_sheetsSyncQueue ? [_sheetsSyncQueue] : []),
  ];
  await Promise.all(queues.map((queue) => queue.close()));
  _validationQueues.clear();
  _sheetsSyncQueue = null;
}
