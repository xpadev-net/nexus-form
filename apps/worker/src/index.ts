import "./load-env";
import { fileURLToPath } from "node:url";
import { providerRegistry, startupPlugins } from "@nexus-form/integrations";
import type { Worker } from "bullmq";
import { handleGenericValidation } from "./handlers/generic-validation";
import { handleGsDiffSync } from "./handlers/gs-diff-sync";
import { handleSheetsSync } from "./handlers/sheets-sync";
import { startQueueMetricsCollection } from "./lib/queue-metrics";
import { createWorker } from "./lib/worker-factory";

const BUILTIN_PLUGIN_SPECIFIERS = [
  "@nexus-form/validation-provider-discord/plugin",
  "@nexus-form/validation-provider-github/plugin",
  "@nexus-form/validation-provider-twitter/plugin",
];

const VALIDATION_PLUGINS_DIR =
  process.env.VALIDATION_PLUGINS_DIR || "/app/plugins/validation";

async function main() {
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
  process.on("SIGTERM", () => {
    if (metricsInterval) clearInterval(metricsInterval);
    Promise.all(workers.map((w) => w.close())).catch((err) => {
      console.error("[worker] Error during graceful shutdown:", err);
    });
  });
}

main().catch((error) => {
  console.error("[worker] Fatal error during startup:", error);
  process.exit(1);
});
