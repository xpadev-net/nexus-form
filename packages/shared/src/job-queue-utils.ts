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
): Promise<void> {
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
      await existingJob.changeDelay(params.delay);
    }
  }

  await queue.add(params.jobName, params.jobData, {
    ...(params.delay !== undefined ? { delay: params.delay } : {}),
    jobId: params.jobId,
  });
}
