import { FORM_SUBMIT_NOTIFICATION_QUEUE } from "@nexus-form/shared";

export const GOOGLE_SHEETS_SYNC_QUEUE = "google-sheets-sync";
export { FORM_SUBMIT_NOTIFICATION_QUEUE };

export type WorkerQueueSelection = {
  validationQueues: string[];
  includeSheetsSync: boolean;
  includeFormSubmitNotifications: boolean;
  unknownQueues: string[];
};

function parseWorkerQueues(value: string): Set<string> {
  const queues = value
    .split(",")
    .map((queue) => queue.trim())
    .filter((queue) => queue.length > 0);

  return new Set(queues);
}

export function validateWorkerQueuesEnv(workerQueuesEnv: string | undefined) {
  if (workerQueuesEnv === undefined) return;

  if (parseWorkerQueues(workerQueuesEnv).size === 0) {
    throw new Error("WORKER_QUEUES did not select any available worker queues");
  }
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
      includeFormSubmitNotifications: true,
      unknownQueues: [],
    };
  }

  const requestedQueues = parseWorkerQueues(workerQueuesEnv);

  const availableQueues = new Set([
    ...availableValidationQueues,
    GOOGLE_SHEETS_SYNC_QUEUE,
    FORM_SUBMIT_NOTIFICATION_QUEUE,
  ]);

  return {
    validationQueues: availableValidationQueues.filter((queueName) =>
      requestedQueues.has(queueName),
    ),
    includeSheetsSync: requestedQueues.has(GOOGLE_SHEETS_SYNC_QUEUE),
    includeFormSubmitNotifications: requestedQueues.has(
      FORM_SUBMIT_NOTIFICATION_QUEUE,
    ),
    unknownQueues: [...requestedQueues].filter(
      (queueName) => !availableQueues.has(queueName),
    ),
  };
}
