import "./load-env";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { db } from "@nexus-form/database";
import { providerRegistry, startupPlugins } from "@nexus-form/integrations";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import { auth } from "./lib/auth";
import { logError } from "./lib/logger";
import { authRouteRateLimiter } from "./lib/rate-limit";
import { captureError, initSentry } from "./lib/sentry";
import { serviceMonitor } from "./lib/services/monitoring";
import { authRouter } from "./routes/auth";
import { avatarRouter } from "./routes/avatar";
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
import { formsResponsesRouter } from "./routes/forms-responses";
import { formsSnapshotsRouter } from "./routes/forms-snapshots";
import { formsSSERouter } from "./routes/forms-sse";
import { formsStructureRouter } from "./routes/forms-structure";
import { formsValidationRulesRouter } from "./routes/forms-validation-rules";
import { integrationsGoogleRouter } from "./routes/integrations-google";
import { s3Router } from "./routes/s3";
import { servicesRouter } from "./routes/services";
import { sessionsRouter } from "./routes/sessions";
import { telemetryRouter } from "./routes/telemetry";
import { tokensRouter } from "./routes/tokens";
import { validationProvidersRouter } from "./routes/validation-providers";

const BUILTIN_PLUGIN_SPECIFIERS = [
  "@nexus-form/validation-provider-discord/plugin",
  "@nexus-form/validation-provider-github/plugin",
  "@nexus-form/validation-provider-twitter/plugin",
];

const VALIDATION_PLUGINS_DIR =
  process.env.VALIDATION_PLUGINS_DIR || "/app/plugins/validation";

const getCorsOrigins = (): string[] => {
  const origins: string[] = ["http://localhost:3000"];
  const trustedOrigins = process.env.TRUSTED_ORIGINS;
  if (trustedOrigins) {
    for (const origin of trustedOrigins.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }
  return [...new Set(origins)];
};

const app = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: getCorsOrigins(),
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
  .route("/api/forms", formsRouter)
  .route("/api/forms", formsDetailRouter)
  .route("/api/forms", formsContentRouter)
  .route("/api/forms", formsSnapshotsRouter)
  .route("/api/forms", formsResponsesRouter)
  .route("/api/forms", formsValidationRulesRouter)
  .route("/api/forms", formsSSERouter)
  .route("/api/forms", formsPermissionsRouter)
  .route("/api/forms", formsStructureRouter)
  .route("/api/forms", formsIntegrationsRouter)
  .route("/api/forms", formsPublicRouter)
  .route("/api/forms", formsInvitesRouter)
  .route("/api/external-service", externalServiceRouter)
  .route("/api/fingerprint", fingerprintRouter)
  .route("/api/s3", s3Router)
  .route("/api/tokens", tokensRouter)
  .route("/api/integrations/google", integrationsGoogleRouter)
  .route("/api/telemetry", telemetryRouter)
  .route("/api/services", servicesRouter)
  .route("/api/sessions", sessionsRouter)
  .route("/api/csrf", csrfRouter)
  .route("/api/avatar", avatarRouter)
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
  const builtinPlugins = BUILTIN_PLUGIN_SPECIFIERS.map((specifier) =>
    fileURLToPath(import.meta.resolve(specifier)),
  );
  await startupPlugins(providerRegistry, {
    builtinPlugins,
    pluginsDirs: [VALIDATION_PLUGINS_DIR],
    logPrefix: "api",
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

    process.on("SIGTERM", () => {
      serviceMonitor.stopPeriodicCheck();
    });
  }

  const port = Number(process.env.PORT) || 3001;
  console.log(`Server is running on http://localhost:${port}`);
  serve({
    fetch: app.fetch,
    port,
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
