import "./load-env";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_VALIDATION_PLUGIN_SPECIFIERS,
  getValidationPluginsDir,
  normalizeBuiltinPluginPath,
  providerRegistry,
  startupPlugins,
} from "@nexus-form/integrations";
import type { Worker } from "bullmq";
import { UnrecoverableError } from "bullmq";
import Redis from "ioredis";
import { handleGenericValidation } from "./handlers/generic-validation";
import {
  AUTH_REQUIRED_SYNC_ERROR_PREFIX,
  handleSheetsSync,
} from "./handlers/sheets-sync";
import { assertGoogleOAuthEncryptionKeyConfigured } from "./lib/field-encryption";
import {
  createGracefulShutdown,
  registerShutdownHandlers,
} from "./lib/graceful-shutdown";
import {
  closeMetricsQueues,
  startQueueMetricsCollection,
} from "./lib/queue-metrics";
import { getPublisherConnectionOptions } from "./lib/redis";
import { closeLockClient } from "./lib/redis-lock";
import { closePublisher } from "./lib/redis-publisher";
import { captureError, flushSentry, initSentry } from "./lib/sentry";
import { abortWorkerShutdown } from "./lib/shutdown-signal";
import { createWorker } from "./lib/worker-factory";
import {
  GOOGLE_SHEETS_SYNC_QUEUE,
  selectWorkerQueues,
  validateWorkerQueuesEnv,
} from "./lib/worker-queue-selection";

const VALIDATION_PLUGINS_DIR = getValidationPluginsDir();
const VALIDATION_PLUGINS_FAIL_FAST =
  process.env.VALIDATION_PLUGINS_FAIL_FAST !== "false";

/**
 * グレースフルシャットダウンの最大待機時間。
 * これを超えてもワーカーが close しない場合は強制終了する。
 */
const shutdownTimeoutEnv = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS);
const SHUTDOWN_TIMEOUT_MS =
  Number.isFinite(shutdownTimeoutEnv) && shutdownTimeoutEnv > 0
    ? shutdownTimeoutEnv
    : 30_000;
const UNCAUGHT_EXCEPTION_SHUTDOWN_TIMEOUT_MS = Math.min(
  SHUTDOWN_TIMEOUT_MS,
  5_000,
);

async function main() {
  console.log(`[worker] Commit: ${process.env.GIT_HASH || "unknown"}`);
  await initSentry();
  assertGoogleOAuthEncryptionKeyConfigured();
  validateWorkerQueuesEnv(process.env.WORKER_QUEUES);

  const builtinPlugins = BUILTIN_VALIDATION_PLUGIN_SPECIFIERS.map((spec) => {
    return normalizeBuiltinPluginPath(fileURLToPath(import.meta.resolve(spec)));
  });
  const pluginDriftStore = new Redis(getPublisherConnectionOptions());
  let pluginDriftGuardHandle: Awaited<ReturnType<typeof startupPlugins>>;
  try {
    pluginDriftGuardHandle = await startupPlugins(providerRegistry, {
      builtinPlugins,
      pluginsDirs: [VALIDATION_PLUGINS_DIR],
      logPrefix: "worker",
      failOnExternalPluginError: VALIDATION_PLUGINS_FAIL_FAST,
      pluginDriftGuard: {
        role: "worker",
        store: pluginDriftStore,
      },
    });
  } catch (error) {
    try {
      await pluginDriftStore.quit();
    } catch (closeError) {
      console.warn(
        "[worker] Failed to close plugin drift Redis client after startup failure:",
        closeError,
      );
    }
    throw error;
  }
  const closePluginDriftGuard = async (): Promise<void> => {
    await pluginDriftGuardHandle?.stop();
    try {
      await pluginDriftStore.quit();
    } catch (error) {
      console.warn(
        "[worker] Failed to close plugin drift Redis client:",
        error,
      );
    }
  };

  const workers: Worker[] = [];
  const selectedQueues = selectWorkerQueues(
    providerRegistry.getNames(),
    process.env.WORKER_QUEUES,
  );

  if (selectedQueues.unknownQueues.length > 0) {
    throw new Error(
      `Unknown WORKER_QUEUES entries: ${selectedQueues.unknownQueues.join(", ")}`,
    );
  }

  for (const queueName of selectedQueues.validationQueues) {
    workers.push(createWorker(queueName, handleGenericValidation));
  }

  if (selectedQueues.includeSheetsSync) {
    workers.push(createWorker(GOOGLE_SHEETS_SYNC_QUEUE, handleSheetsSync));
  }

  if (workers.length === 0) {
    throw new Error(
      "Internal error: worker list is empty after queue selection",
    );
  }

  const getJobContext = (
    queueName: string,
    job?: {
      id?: string | null;
      attemptsMade?: number;
      opts?: { attempts?: number };
      data?: unknown;
    } | null,
  ) => {
    const record =
      typeof job?.data === "object" && job.data !== null
        ? (job.data as Record<string, unknown>)
        : {};
    return {
      queue: queueName,
      queueJobId: job?.id ?? "unknown",
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts,
      formId: record.formId,
      integrationId: record.integrationId,
      responseId: record.responseId,
    };
  };

  const attachJobContextToError = (
    error: unknown,
    context: {
      queue: string;
      queueJobId: string;
      attemptsMade?: number;
      maxAttempts?: number;
      formId?: unknown;
      integrationId?: unknown;
      responseId?: unknown;
    },
  ) => {
    if (error instanceof Error) {
      (error as Error & { workerContext?: typeof context }).workerContext =
        context;
      return error;
    }
    const wrapped = new Error(String(error));
    const contextualError = wrapped as Error & {
      workerContext?: typeof context;
      cause?: unknown;
    };
    contextualError.cause = error;
    contextualError.workerContext = context;
    return contextualError;
  };

  for (const worker of workers) {
    worker.on("completed", (job) => {
      console.log(`[worker:${worker.name}] completed job=${job.id}`);
    });
    worker.on("failed", (job, error) => {
      const context = getJobContext(worker.name, job);
      console.error(
        `[worker:${worker.name}] failed job=${context.queueJobId} attempt=${context.attemptsMade}/${context.maxAttempts}`,
        error,
        context,
      );
      const contextualError = attachJobContextToError(error, context);
      const attemptsMade = job?.attemptsMade ?? 1;
      const maxAttempts = job?.opts?.attempts ?? 1;
      const isFinalFailureAttempt = attemptsMade >= maxAttempts;
      const isUnrecoverableError =
        contextualError instanceof UnrecoverableError;
      const isAuthRequiredError =
        worker.name === GOOGLE_SHEETS_SYNC_QUEUE &&
        isUnrecoverableError &&
        contextualError.message.startsWith(AUTH_REQUIRED_SYNC_ERROR_PREFIX);

      if (
        (isFinalFailureAttempt || isUnrecoverableError) &&
        !isAuthRequiredError
      ) {
        captureError(contextualError);
      }
    });
    worker.on("error", (error) => {
      console.error(`[worker:${worker.name}] worker error`, error);
      const context = getJobContext(worker.name);
      const contextualError = attachJobContextToError(error, context);
      captureError(contextualError);
    });
  }

  console.log(
    "Workers started:",
    workers.map((worker) => worker.name),
  );

  const metricsInterval = startQueueMetricsCollection();
  const { shutdown: baseShutdown } = createGracefulShutdown({
    workers,
    metricsInterval,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    closeMetricsQueues,
    closePublisher,
    closePluginDriftGuard,
    closeLockClient,
    flushSentry,
    captureError,
    exit: process.exit.bind(process),
    logger: console,
  });
  const shutdown: typeof baseShutdown = async (request) => {
    abortWorkerShutdown(
      new DOMException(`Worker shutdown (${request.trigger})`, "AbortError"),
    );
    await baseShutdown(request);
  };

  registerShutdownHandlers({
    process,
    shutdown,
    captureError,
    logger: console,
    uncaughtExceptionTimeoutMs: UNCAUGHT_EXCEPTION_SHUTDOWN_TIMEOUT_MS,
  });
}

main().catch(async (error) => {
  console.error("[worker] Fatal error during startup:", error);
  captureError(error);
  await flushSentry();
  process.exit(1);
});
