export type QueueJobHandleLike = {
  getState(): Promise<string>;
  remove(): Promise<void>;
};

export type QueueWithJobLookupLike<TJobData> = {
  getJob(jobId: string): Promise<QueueJobHandleLike | null | undefined>;
  add(
    jobName: string,
    jobData: TJobData,
    options: { jobId: string },
  ): Promise<unknown>;
};

export async function addJobWithCleanup<TJobData>(
  queue: QueueWithJobLookupLike<TJobData>,
  params: {
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
    }
  }

  await queue.add(params.jobName, params.jobData, {
    jobId: params.jobId,
  });
}
