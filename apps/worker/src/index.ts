import "./load-env";
import { fileURLToPath } from "node:url";
import { providerRegistry, startupPlugins } from "@nexus-form/integrations";
import type { Worker } from "bullmq";
import { handleGenericValidation } from "./handlers/generic-validation";
import { handleGsDiffSync } from "./handlers/gs-diff-sync";
import { handleSheetsSync } from "./handlers/sheets-sync";
import { startQueueMetricsCollection } from "./lib/queue-metrics";
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

let shuttingDown = false;

/**
 * 実行中ジョブをドレインしてからプロセスを終了する。
 * SIGTERM / SIGINT の両方から呼ばれ、二重実行はガードする。
 */
async function gracefulShutdown(
  signal: NodeJS.Signals,
  workers: Worker[],
  metricsInterval: ReturnType<typeof setInterval> | null,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[worker] Received ${signal}, draining in-flight jobs...`);
  if (metricsInterval) clearInterval(metricsInterval);

  const forceExit = setTimeout(() => {
    console.error(
      `[worker] Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`,
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // タイマーがイベントループを延命しないようにする。
  forceExit.unref();

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    clearTimeout(forceExit);
    console.log("[worker] All workers closed gracefully");
    await flushSentry();
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExit);
    console.error("[worker] Error during graceful shutdown:", err);
    captureError(err);
    await flushSentry();
    process.exit(1);
  }
}

async function main() {
  await initSentry();

  // unhandledRejection はプロセス状態が不定になりうるため、Node v15+ の
  // デフォルト挙動と同様に、Sentry へ送信したうえで終了する。
  process.on("unhandledRejection", (reason) => {
    console.error("[worker] Unhandled promise rejection:", reason);
    captureError(reason);
    void flushSentry().finally(() => process.exit(1));
  });
  // uncaughtException 後はプロセス状態が不定なため、Sentry へ送信したうえで終了する。
  process.on("uncaughtException", (error) => {
    console.error("[worker] Uncaught exception:", error);
    captureError(error);
    void flushSentry().finally(() => process.exit(1));
  });

  const builtinPlugins = BUILTIN_PLUGIN_SPECIFIERS.map((specifier) =>
    fileURLToPath(import.meta.resolve(specifier)),
  );
  await startupPlugins(providerRegistry, {
    builtinPlugins,
    pluginsDirs: [VALIDATION_PLUGINS_DIR],
    logPrefix: "worker",
  });

  const workers: Worker[] = [];

  for (const providerName of providerRegistry.getNames()) {
    const queueName = `${providerName}-validation`;
    workers.push(createWorker(queueName, handleGenericValidation));
  }

  workers.push(createWorker("google-sheets-sync", handleSheetsSync));
  workers.push(createWorker("google-sheets-diff-sync", handleGsDiffSync));

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

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void gracefulShutdown(signal, workers, metricsInterval);
    });
  }
}

main().catch(async (error) => {
  console.error("[worker] Fatal error during startup:", error);
  captureError(error);
  await flushSentry();
  process.exit(1);
});
