export const GOOGLE_SHEETS_SYNC_QUEUE = "google-sheets-sync";

export type WorkerQueueSelection = {
  validationQueues: string[];
  includeSheetsSync: boolean;
  unknownQueues: string[];
};

function parseWorkerQueues(value: string): Set<string> {
  const queues = value
    .split(",")
    .map((queue) => queue.trim())
    .filter((queue) => queue.length > 0);

  return new Set(queues);
}

export function selectWorkerQueues(
  providerNames: readonly string[],
  workerQueuesEnv: string | undefined,
): WorkerQueueSelection {
  const availableValidationQueues = providerNames.map(
    (providerName) => `${providerName}-validation`,
  );

  if (workerQueuesEnv === undefined) {
    return {
      validationQueues: availableValidationQueues,
      includeSheetsSync: true,
      unknownQueues: [],
    };
  }

  const requestedQueues = parseWorkerQueues(workerQueuesEnv);

  const availableQueues = new Set([
    ...availableValidationQueues,
    GOOGLE_SHEETS_SYNC_QUEUE,
  ]);

  return {
    validationQueues: availableValidationQueues.filter((queueName) =>
      requestedQueues.has(queueName),
    ),
    includeSheetsSync: requestedQueues.has(GOOGLE_SHEETS_SYNC_QUEUE),
    unknownQueues: [...requestedQueues].filter(
      (queueName) => !availableQueues.has(queueName),
    ),
  };
}
