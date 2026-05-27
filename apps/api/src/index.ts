import "./load-env";
import { serve } from "@hono/node-server";
import { closeDatabase, db } from "@nexus-form/database";
import {
  BUILTIN_VALIDATION_PLUGIN_SPECIFIERS,
  getValidationPluginsDir,
  providerRegistry,
  resolveBuiltinPluginSpecifier,
  startupPlugins,
} from "@nexus-form/integrations";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import { auth } from "./lib/auth";
import { closeRedisClient, getRedisClient } from "./lib/cache/redis-client";
import {
  getCorsOrigins,
  warnIfProductionCorsOriginsEmpty,
} from "./lib/cors-origins";
import { assertGoogleOAuthEncryptionKeyConfigured } from "./lib/crypto/field-encryption";
import { createCsrfOriginGuard } from "./lib/csrf-origin-guard";
import { createValidationOutboxSweeper } from "./lib/forms/validation-outbox-sweeper";
import {
  createApiGracefulShutdown,
  registerApiShutdownHandlers,
} from "./lib/graceful-shutdown";
import { logError } from "./lib/logger";
import { closeQueues } from "./lib/queues";
import { authRouteRateLimiter } from "./lib/rate-limit";
import { closePublisher } from "./lib/redis-publisher";
import { captureError, flushSentry, initSentry } from "./lib/sentry";
import { serviceMonitor } from "./lib/services/monitoring";
import { authRouter } from "./routes/auth";
import { csrfRouter } from "./routes/csrf";
import { externalServiceRouter } from "./routes/external-service";
import { fingerprintRouter } from "./routes/fingerprint";
import { formsRouter } from "./routes/forms";
import { formsContentRouter } from "./routes/forms-content";
import { formsDetailRouter } from "./routes/forms-detail";
import { formsIntegrationsRouter } from "./routes/forms-integrations";
import { formsInvitesRouter } from "./routes/forms-invites";
import { formsPermissionsRouter } from "./routes/forms-permissions";
import { formsPublicRouter } from "./routes/forms-public";
import { formsResponseAnalyticsRouter } from "./routes/forms-response-analytics";
import { formsResponsesRouter } from "./routes/forms-responses";
import { formsScheduleRouter } from "./routes/forms-schedule";
import { formsSnapshotsRouter } from "./routes/forms-snapshots";
import { closeSseSubscribers, formsSSERouter } from "./routes/forms-sse";
import { formsStructureRouter } from "./routes/forms-structure";
import { formsValidationRulesRouter } from "./routes/forms-validation-rules";
import { integrationsGoogleRouter } from "./routes/integrations-google";
import { s3Router } from "./routes/s3";
import { servicesRouter } from "./routes/services";
import { sessionsRouter } from "./routes/sessions";
import { telemetryRouter } from "./routes/telemetry";
import { tokensRouter } from "./routes/tokens";
import { validationProvidersRouter } from "./routes/validation-providers";

const VALIDATION_PLUGINS_DIR = getValidationPluginsDir();
const VALIDATION_PLUGINS_FAIL_FAST =
  process.env.VALIDATION_PLUGINS_FAIL_FAST !== "false";
const shutdownTimeoutEnv = Number(process.env.API_SHUTDOWN_TIMEOUT_MS);
const SHUTDOWN_TIMEOUT_MS =
  Number.isFinite(shutdownTimeoutEnv) && shutdownTimeoutEnv > 0
    ? shutdownTimeoutEnv
    : 30_000;
const UNCAUGHT_EXCEPTION_SHUTDOWN_TIMEOUT_MS = Math.min(
  SHUTDOWN_TIMEOUT_MS,
  5_000,
);

const corsOrigins = getCorsOrigins();
warnIfProductionCorsOriginsEmpty(corsOrigins);

const app = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  )
  .use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production") {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    await next();
  })
  .use("/api/*", createCsrfOriginGuard(corsOrigins))
  // Better Auth routes with path-based rate limiting
  .use("/api/auth/*", authRouteRateLimiter)
  .on(["POST", "GET"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
  })
  // Health check
  .get("/api/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  })
  // K8s/LB health check
  .get("/api/healthz", async (c) => {
    try {
      await db.execute(sql`SELECT 1`);
      return c.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
      });
    } catch (_error) {
      return c.json(
        {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          error: "Database connectivity check failed",
        },
        503,
      );
    }
  })
  .route("/api/auth-ext", authRouter)
  .route("/api/forms", formsPublicRouter)
  .route("/api/forms", formsInvitesRouter)
  .route("/api/forms", formsRouter)
  .route("/api/forms", formsDetailRouter)
  .route("/api/forms", formsContentRouter)
  .route("/api/forms", formsSnapshotsRouter)
  .route("/api/forms", formsResponseAnalyticsRouter)
  .route("/api/forms", formsResponsesRouter)
  .route("/api/forms", formsScheduleRouter)
  .route("/api/forms", formsValidationRulesRouter)
  .route("/api/forms", formsSSERouter)
  .route("/api/forms", formsPermissionsRouter)
  .route("/api/forms", formsStructureRouter)
  .route("/api/forms", formsIntegrationsRouter)
  .route("/api/external-service", externalServiceRouter)
  .route("/api/fingerprint", fingerprintRouter)
  .route("/api/s3", s3Router)
  .route("/api/tokens", tokensRouter)
  .route("/api/integrations/google", integrationsGoogleRouter)
  .route("/api/telemetry", telemetryRouter)
  .route("/api/services", servicesRouter)
  .route("/api/sessions", sessionsRouter)
  .route("/api/csrf", csrfRouter)
  .route("/api/validation-providers", validationProvidersRouter)
  // 未捕捉エラーの集約ハンドラ。レスポンススキーマの `.parse()` が投げる
  // ZodError などをログ／Sentry に送り、構造化された 500 を返す。
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    const isZodError = err instanceof ZodError;
    logError(
      isZodError
        ? "Response schema validation failed"
        : "Unhandled error in API route",
      "api",
      { error: err, path: c.req.path },
    );
    captureError(err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

export default app;
export type AppType = typeof app;

async function startServer() {
  console.log(`[api] Commit: ${process.env.GIT_HASH || "unknown"}`);
  assertGoogleOAuthEncryptionKeyConfigured();

  const builtinPlugins = BUILTIN_VALIDATION_PLUGIN_SPECIFIERS.map(
    resolveBuiltinPluginSpecifier,
  );
  const pluginDriftStore = getRedisClient();
  if (!pluginDriftStore) {
    console.warn(
      "[api] Plugin drift guard skipped because Redis is not configured",
    );
  }
  const pluginStartupHandle = await startupPlugins(providerRegistry, {
    builtinPlugins,
    pluginsDirs: [VALIDATION_PLUGINS_DIR],
    logPrefix: "api",
    failOnExternalPluginError: VALIDATION_PLUGINS_FAIL_FAST,
    pluginDriftGuard: pluginDriftStore
      ? {
          role: "api",
          store: pluginDriftStore,
        }
      : undefined,
  });

  // Sentry 初期化
  initSentry().catch(() => {
    // Sentry が利用できない場合は無視
  });

  // サービスモニタリング開始 (5分間隔)
  const monitoringInterval = Number(
    process.env.SERVICE_MONITORING_INTERVAL ?? "300000",
  );
  if (monitoringInterval > 0) {
    serviceMonitor.startPeriodicCheck(monitoringInterval);
  }
  const validationOutboxSweeper = createValidationOutboxSweeper();
  validationOutboxSweeper.start();

  const port = Number(process.env.PORT) || 3001;
  console.log(`Server is running on http://localhost:${port}`);
  const server = serve({
    fetch: app.fetch,
    port,
  });

  const { shutdown } = createApiGracefulShutdown({
    server,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    stopServiceMonitor: () => serviceMonitor.stopPeriodicCheck(),
    stopValidationOutboxSweeper: () => validationOutboxSweeper.stop(),
    stopPluginDriftGuard: async () => {
      await pluginStartupHandle?.stop();
    },
    closeQueues,
    closeSseSubscribers,
    closePublisher,
    closeRedisClient,
    closeDatabase,
    flushSentry,
    captureError,
    exit: process.exit.bind(process),
    logger: console,
  });

  registerApiShutdownHandlers({
    process,
    shutdown,
    captureError,
    logger: console,
    uncaughtExceptionTimeoutMs: UNCAUGHT_EXCEPTION_SHUTDOWN_TIMEOUT_MS,
  });
}

// Only start the server when this module is the entry point
const isEntryPoint =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntryPoint) {
  startServer().catch((error) => {
    console.error("[api] Fatal error during startup:", error);
    process.exit(1);
  });
}
