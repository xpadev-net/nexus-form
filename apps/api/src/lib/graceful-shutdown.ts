export type ApiShutdownTrigger =
  | NodeJS.Signals
  | "unhandledRejection"
  | "uncaughtException";

export interface CloseableServer {
  close: (callback: (error?: Error) => void) => void;
}

export interface ApiGracefulShutdownOptions {
  server: CloseableServer;
  timeoutMs: number;
  stopServiceMonitor: () => void;
  stopPluginDriftGuard?: () => Promise<void>;
  closeQueues: () => Promise<void>;
  closeSseSubscribers?: () => Promise<void>;
  closePublisher: () => Promise<void>;
  closeRedisClient: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  flushSentry: () => Promise<void>;
  captureError: (error: unknown) => void;
  exit: (code: number) => void;
  logger: Pick<Console, "log" | "error">;
}

export interface ApiGracefulShutdownRequest {
  trigger: ApiShutdownTrigger;
  exitCode?: number;
  error?: unknown;
  timeoutMs?: number;
}

export interface ApiGracefulShutdownController {
  shutdown: (request: ApiGracefulShutdownRequest) => Promise<void>;
}

export interface ApiShutdownProcess {
  on(event: "SIGTERM" | "SIGINT", listener: () => void): void;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  on(event: "uncaughtException", listener: (error: Error) => void): void;
}

export interface RegisterApiShutdownHandlersOptions {
  process: ApiShutdownProcess;
  shutdown: ApiGracefulShutdownController["shutdown"];
  captureError: (error: unknown) => void;
  logger: Pick<Console, "error">;
  uncaughtExceptionTimeoutMs: number;
}

type ShutdownTimer = ReturnType<typeof setTimeout> & {
  unref?: () => void;
};

function closeServer(server: CloseableServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runCleanupStep(
  label: string,
  cleanup: () => void | Promise<void>,
  logger: Pick<Console, "error">,
  captureError: (error: unknown) => void,
): Promise<boolean> {
  try {
    await cleanup();
    return true;
  } catch (error) {
    logger.error(`[api] Failed to ${label}:`, error);
    captureError(error);
    return false;
  }
}

export function createApiGracefulShutdown({
  server,
  timeoutMs,
  stopServiceMonitor,
  stopPluginDriftGuard = async () => undefined,
  closeQueues,
  closeSseSubscribers = async () => undefined,
  closePublisher,
  closeRedisClient,
  closeDatabase,
  flushSentry,
  captureError,
  exit,
  logger,
}: ApiGracefulShutdownOptions): ApiGracefulShutdownController {
  let shuttingDown = false;
  let finalExitCode = 0;
  let forceExit: ShutdownTimer | null = null;

  const scheduleForceExit = (activeTimeoutMs: number): void => {
    if (forceExit) clearTimeout(forceExit);
    forceExit = setTimeout(() => {
      logger.error(
        `[api] Graceful shutdown timed out after ${activeTimeoutMs}ms, forcing exit`,
      );
      exit(1);
    }, activeTimeoutMs);
    forceExit.unref?.();
  };

  const clearForceExit = (): void => {
    if (forceExit) {
      clearTimeout(forceExit);
      forceExit = null;
    }
  };

  return {
    async shutdown({
      trigger,
      exitCode = 0,
      error,
      timeoutMs: requestTimeoutMs = timeoutMs,
    }: ApiGracefulShutdownRequest): Promise<void> {
      if (error !== undefined) {
        captureError(error);
      }

      if (shuttingDown) {
        if (exitCode !== 0) {
          finalExitCode = 1;
          scheduleForceExit(requestTimeoutMs);
        }
        return;
      }

      finalExitCode = exitCode;
      shuttingDown = true;
      logger.log(`[api] Received ${trigger}, draining HTTP requests...`);
      scheduleForceExit(requestTimeoutMs);

      const cleanupResults: boolean[] = [];
      cleanupResults.push(
        await runCleanupStep(
          "close SSE subscribers",
          closeSseSubscribers,
          logger,
          captureError,
        ),
      );
      cleanupResults.push(
        await runCleanupStep(
          "close HTTP server",
          () => closeServer(server),
          logger,
          captureError,
        ),
      );
      cleanupResults.push(
        await runCleanupStep(
          "stop service monitor",
          stopServiceMonitor,
          logger,
          captureError,
        ),
      );
      cleanupResults.push(
        await runCleanupStep(
          "stop plugin drift guard",
          stopPluginDriftGuard,
          logger,
          captureError,
        ),
      );
      cleanupResults.push(
        await runCleanupStep("close queues", closeQueues, logger, captureError),
      );
      cleanupResults.push(
        await runCleanupStep(
          "close Redis publisher",
          closePublisher,
          logger,
          captureError,
        ),
      );
      cleanupResults.push(
        await runCleanupStep(
          "close Redis cache client",
          closeRedisClient,
          logger,
          captureError,
        ),
      );
      cleanupResults.push(
        await runCleanupStep(
          "close database",
          closeDatabase,
          logger,
          captureError,
        ),
      );
      const shutdownSucceeded = cleanupResults.every(Boolean);

      if (shutdownSucceeded) {
        logger.log("[api] HTTP server and resources closed gracefully");
      }

      const sentryFlushed = await runCleanupStep(
        "flush Sentry",
        flushSentry,
        logger,
        captureError,
      );
      clearForceExit();
      if (shutdownSucceeded && sentryFlushed) {
        exit(finalExitCode);
      } else {
        exit(1);
      }
    },
  };
}

export function registerApiShutdownHandlers({
  process,
  shutdown,
  captureError,
  logger,
  uncaughtExceptionTimeoutMs,
}: RegisterApiShutdownHandlersOptions): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void shutdown({ trigger: signal });
    });
  }

  process.on("unhandledRejection", (reason) => {
    logger.error("[api] Unhandled promise rejection:", reason);
    void shutdown({
      trigger: "unhandledRejection",
      exitCode: 1,
      error: reason,
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("[api] Uncaught exception:", error);
    captureError(error);
    void shutdown({
      trigger: "uncaughtException",
      exitCode: 1,
      timeoutMs: uncaughtExceptionTimeoutMs,
    });
  });
}
