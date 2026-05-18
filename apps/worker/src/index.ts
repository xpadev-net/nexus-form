import "./load-env";
import { fileURLToPath } from "node:url";
import { providerRegistry, startupPlugins } from "@nexus-form/integrations";
import type { Worker } from "bullmq";
import Redis from "ioredis";
import { handleGenericValidation } from "./handlers/generic-validation";
import { handleSheetsSync } from "./handlers/sheets-sync";
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
import { createWorker } from "./lib/worker-factory";

const BUILTIN_PLUGIN_SPECIFIERS = [
  "@nexus-form/validation-provider-discord/plugin",
  "@nexus-form/validation-provider-github/plugin",
  "@nexus-form/validation-provider-twitter/plugin",
];

const VALIDATION_PLUGINS_DIR =
  process.env.VALIDATION_PLUGINS_DIR || "/app/plugins/validation";

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
  await initSentry();

  const builtinPlugins = BUILTIN_PLUGIN_SPECIFIERS.map((specifier) =>
    fileURLToPath(import.meta.resolve(specifier)),
  );
  const pluginDriftStore = new Redis(getPublisherConnectionOptions());
  try {
    await startupPlugins(providerRegistry, {
      builtinPlugins,
      pluginsDirs: [VALIDATION_PLUGINS_DIR],
      logPrefix: "worker",
      pluginDriftGuard: {
        role: "worker",
        store: pluginDriftStore,
      },
    });
  } finally {
    try {
      await pluginDriftStore.quit();
    } catch (error) {
      console.warn(
        "[worker] Failed to close plugin drift Redis client:",
        error,
      );
    }
  }

  const workers: Worker[] = [];

  for (const providerName of providerRegistry.getNames()) {
    const queueName = `${providerName}-validation`;
    workers.push(createWorker(queueName, handleGenericValidation));
  }

  workers.push(createWorker("google-sheets-sync", handleSheetsSync));

  for (const worker of workers) {
    worker.on("completed", (job) => {
      console.log(`[worker:${worker.name}] completed job=${job.id}`);
    });
    worker.on("failed", (job, error) => {
      console.error(`[worker:${worker.name}] failed job=${job?.id}`, error);
    });
  }

  console.log(
    "Workers started:",
    workers.map((worker) => worker.name),
  );

  const metricsInterval = startQueueMetricsCollection();
  const { shutdown } = createGracefulShutdown({
    workers,
    metricsInterval,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    closeMetricsQueues,
    closePublisher,
    closeLockClient,
    flushSentry,
    captureError,
    exit: process.exit.bind(process),
    logger: console,
  });

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
