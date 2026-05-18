/** Events that can initiate worker shutdown. */
export type ShutdownTrigger =
  | NodeJS.Signals
  | "unhandledRejection"
  | "uncaughtException";

/** Minimal BullMQ worker surface needed to drain in-flight jobs. */
export interface CloseableWorker {
  close: () => Promise<void>;
}

/** Runtime dependencies used by the worker graceful shutdown controller. */
export interface GracefulShutdownOptions {
  /** Workers to close before exiting. */
  workers: CloseableWorker[];
  /** Queue metrics interval handle, if metrics collection was started. */
  metricsInterval: ReturnType<typeof setInterval> | null;
  /** Default forced-exit timeout in milliseconds. */
  timeoutMs: number;
  /** Closes BullMQ Queue instances used only for metrics collection. */
  closeMetricsQueues: () => Promise<void>;
  /** Closes the shared Redis publisher after workers have drained. */
  closePublisher: () => Promise<void>;
  /** Closes the shared Redis lock client after workers have drained. */
  closeLockClient: () => Promise<void>;
  /** Flushes pending Sentry events before process exit. */
  flushSentry: () => Promise<void>;
  /** Records the triggering or shutdown error. */
  captureError: (error: unknown) => void;
  /** Exits the process with the final status code. */
  exit: (code: number) => void;
  /** Logger used for shutdown progress and failures. */
  logger: Pick<Console, "log" | "error">;
}

/** One shutdown request emitted by a signal or global exception handler. */
export interface GracefulShutdownRequest {
  /** Signal or exception event that started shutdown. */
  trigger: ShutdownTrigger;
  /** Final exit code after a successful drain. Defaults to 0. */
  exitCode?: number;
  /** Original error/rejection to capture before draining workers. */
  error?: unknown;
  /** Per-request forced-exit timeout in milliseconds. */
  timeoutMs?: number;
}

/** Controller that drains workers once and exits the process. */
export interface GracefulShutdownController {
  shutdown: (request: GracefulShutdownRequest) => Promise<void>;
}

/** Process event surface used by shutdown handler registration. */
export interface ShutdownProcess {
  on(event: "SIGTERM" | "SIGINT", listener: () => void): void;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  on(event: "uncaughtException", listener: (error: Error) => void): void;
}

/** Dependencies for wiring process events to graceful shutdown. */
export interface RegisterShutdownHandlersOptions {
  /** Process-like object that receives signal and exception listeners. */
  process: ShutdownProcess;
  /** Shutdown callback created by createGracefulShutdown. */
  shutdown: GracefulShutdownController["shutdown"];
  /** Captures uncaught exceptions before the shutdown attempt starts. */
  captureError: (error: unknown) => void;
  /** Logger used for exception diagnostics. */
  logger: Pick<Console, "error">;
  /** Short forced-exit timeout for uncaughtException shutdown attempts. */
  uncaughtExceptionTimeoutMs: number;
}

type ShutdownTimer = ReturnType<typeof setTimeout> & {
  unref?: () => void;
};

/**
 * Creates an idempotent shutdown controller that closes workers, releases Redis
 * lock resources, flushes telemetry, and exits with the requested status code.
 */
export function createGracefulShutdown({
  workers,
  metricsInterval,
  timeoutMs,
  closeMetricsQueues,
  closePublisher,
  closeLockClient,
  flushSentry,
  captureError,
  exit,
  logger,
}: GracefulShutdownOptions): GracefulShutdownController {
  let shuttingDown = false;
  let finalExitCode = 0;
  let forceExit: ShutdownTimer | null = null;

  const scheduleForceExit = (activeTimeoutMs: number): void => {
    if (forceExit) clearTimeout(forceExit);
    forceExit = setTimeout(() => {
      logger.error(
        `[worker] Graceful shutdown timed out after ${activeTimeoutMs}ms, forcing exit`,
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
    }: GracefulShutdownRequest): Promise<void> {
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
      logger.log(`[worker] Received ${trigger}, draining in-flight jobs...`);
      if (metricsInterval) clearInterval(metricsInterval);
      scheduleForceExit(requestTimeoutMs);

      try {
        await Promise.all(workers.map((worker) => worker.close()));
        await Promise.all([closeMetricsQueues(), closePublisher()]);
        await closeLockClient();
        logger.log("[worker] All workers closed gracefully");
        await flushSentry();
        clearForceExit();
        exit(finalExitCode);
      } catch (shutdownError) {
        logger.error("[worker] Error during graceful shutdown:", shutdownError);
        captureError(shutdownError);
        await flushSentry();
        clearForceExit();
        exit(1);
      }
    },
  };
}

/**
 * Registers process signal and global exception handlers that route all exits
 * through the provided graceful shutdown callback.
 */
export function registerShutdownHandlers({
  process,
  shutdown,
  captureError,
  logger,
  uncaughtExceptionTimeoutMs,
}: RegisterShutdownHandlersOptions): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void shutdown({ trigger: signal });
    });
  }

  process.on("unhandledRejection", (reason) => {
    logger.error("[worker] Unhandled promise rejection:", reason);
    void shutdown({
      trigger: "unhandledRejection",
      exitCode: 1,
      error: reason,
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("[worker] Uncaught exception:", error);
    captureError(error);
    void shutdown({
      trigger: "uncaughtException",
      exitCode: 1,
      timeoutMs: uncaughtExceptionTimeoutMs,
    });
  });
}
