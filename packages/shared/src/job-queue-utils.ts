/**
 * Minimal job-handle contract used by dependency-injected queue adapters.
 * Implementations must expose state inspection and removal for an existing job id.
 */
export interface QueueJobHandleLike {
  /** Returns the queue backend's current job state for duplicate/cleanup checks. */
  getState(): Promise<unknown>;
  /** Updates delayed jobs to use a fresh coalescing window when supported. */
  changeDelay?(delay: number): Promise<unknown>;
  /** Removes the job from the queue and resolves when the deletion is acknowledged. */
  remove(): Promise<unknown>;
}

function isJobNotInStateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  return (
    code === "JOB_NOT_IN_STATE" ||
    error.name === "JobNotInState" ||
    error.message.includes("not in the delayed state") ||
    error.message.includes("not in the expected state")
  );
}

/**
 * Minimal queue contract used by addJobWithCleanup() and related helpers.
 * Implementations must support lookup-by-id before enqueueing and stable jobId writes.
 */
export interface QueueWithJobLookupLike<TJobData> {
  /** Returns the existing job handle for a job id, or null/undefined if no job exists. */
  getJob(jobId: string): Promise<QueueJobHandleLike | null | undefined>;
  /** Enqueues a new job with the given name, payload, and required stable jobId. */
  add(
    jobName: string,
    jobData: TJobData,
    options: { delay?: number; jobId: string },
  ): Promise<unknown>;
}

/**
 * Result of a stable-id enqueue attempt.
 *
 * `added` means the requested job id is now represented in the queue. When an
 * existing delayed job was refreshed with `changeDelay()`, `queue.add()` may be
 * a BullMQ no-op for the same id and still counts as `added`. If no delay is
 * provided, delayed-job refresh is skipped and the helper only removes terminal
 * duplicates before adding.
 *
 * `delayed-job-state-changed` means a delayed job left the delayed state while
 * its delay was being refreshed, so the caller should enqueue a fallback job id
 * if the triggering mutation must be observed after the in-flight job.
 */
export type AddJobWithCleanupResult =
  | { outcome: "added" }
  | { outcome: "delayed-job-state-changed" };

/**
 * Removes a failed/completed duplicate job before enqueueing a replacement with the same jobId.
 * This keeps queue implementations aligned with the repository's idempotency contract.
 */
export async function addJobWithCleanup<TJobData>(
  queue: QueueWithJobLookupLike<TJobData>,
  params: {
    delay?: number;
    jobData: TJobData;
    jobId: string;
    jobName: string;
  },
): Promise<AddJobWithCleanupResult> {
  const existingJob = await queue.getJob(params.jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "failed" || state === "completed") {
      try {
        await existingJob.remove();
      } catch (error) {
        if ((await existingJob.getState()) !== "active") {
          throw error;
        }
      }
    } else if (
      state === "delayed" &&
      params.delay !== undefined &&
      existingJob.changeDelay
    ) {
      try {
        await existingJob.changeDelay(params.delay);
      } catch (error) {
        if (!isJobNotInStateError(error)) {
          throw error;
        }
        if ((await existingJob.getState()) === "delayed") {
          throw error;
        }
        return { outcome: "delayed-job-state-changed" };
      }
    }
  }

  await queue.add(params.jobName, params.jobData, {
    ...(params.delay !== undefined ? { delay: params.delay } : {}),
    jobId: params.jobId,
  });
  return { outcome: "added" };
}
