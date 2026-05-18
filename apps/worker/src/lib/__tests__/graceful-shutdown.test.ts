import { describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  type GracefulShutdownController,
  type GracefulShutdownRequest,
  registerShutdownHandlers,
  type ShutdownProcess,
} from "../graceful-shutdown";

function createProcessMock(): {
  process: ShutdownProcess;
  emit: {
    signal: (event: "SIGTERM" | "SIGINT") => void;
    unhandledRejection: (reason: unknown) => void;
    uncaughtException: (error: Error) => void;
  };
} {
  const signalHandlers = new Map<"SIGTERM" | "SIGINT", () => void>();
  let unhandledRejectionHandler: ((reason: unknown) => void) | null = null;
  let uncaughtExceptionHandler: ((error: Error) => void) | null = null;

  const process: ShutdownProcess = {
    on(event, listener) {
      if (event === "SIGTERM" || event === "SIGINT") {
        signalHandlers.set(event, listener as () => void);
        return;
      }
      if (event === "unhandledRejection") {
        unhandledRejectionHandler = listener as (reason: unknown) => void;
        return;
      }
      uncaughtExceptionHandler = listener as (error: Error) => void;
    },
  };

  return {
    process,
    emit: {
      signal(event) {
        signalHandlers.get(event)?.();
      },
      unhandledRejection(reason) {
        unhandledRejectionHandler?.(reason);
      },
      uncaughtException(error) {
        uncaughtExceptionHandler?.(error);
      },
    },
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("createGracefulShutdown", () => {
  it("closes workers, lock client, and exits with the requested code", async () => {
    const worker = { close: vi.fn().mockResolvedValue(undefined) };
    const closeMetricsQueues = vi.fn().mockResolvedValue(undefined);
    const closePublisher = vi.fn().mockResolvedValue(undefined);
    const closeLockClient = vi.fn().mockResolvedValue(undefined);
    const flushSentry = vi.fn().mockResolvedValue(undefined);
    const captureError = vi.fn();
    const exit = vi.fn();

    const { shutdown } = createGracefulShutdown({
      workers: [worker],
      metricsInterval: null,
      timeoutMs: 30_000,
      closeMetricsQueues,
      closePublisher,
      closeLockClient,
      flushSentry,
      captureError,
      exit,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await shutdown({ trigger: "unhandledRejection", exitCode: 1 });

    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(closeMetricsQueues).toHaveBeenCalledTimes(1);
    expect(closePublisher).toHaveBeenCalledTimes(1);
    expect(closeLockClient).toHaveBeenCalledTimes(1);
    expect(flushSentry).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("captures the triggering error before draining workers", async () => {
    const reason = new Error("boom");
    const captureError = vi.fn();
    const { shutdown } = createGracefulShutdown({
      workers: [{ close: vi.fn().mockResolvedValue(undefined) }],
      metricsInterval: null,
      timeoutMs: 30_000,
      closeMetricsQueues: vi.fn().mockResolvedValue(undefined),
      closePublisher: vi.fn().mockResolvedValue(undefined),
      closeLockClient: vi.fn().mockResolvedValue(undefined),
      flushSentry: vi.fn().mockResolvedValue(undefined),
      captureError,
      exit: vi.fn(),
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await shutdown({
      trigger: "unhandledRejection",
      exitCode: 1,
      error: reason,
    });

    expect(captureError).toHaveBeenCalledWith(reason);
  });

  it("escalates the final exit code when a fatal event arrives during signal shutdown", async () => {
    const workerClose = createDeferred();
    const reason = new Error("late rejection");
    const captureError = vi.fn();
    const exit = vi.fn();
    const { shutdown } = createGracefulShutdown({
      workers: [{ close: vi.fn().mockReturnValue(workerClose.promise) }],
      metricsInterval: null,
      timeoutMs: 30_000,
      closeMetricsQueues: vi.fn().mockResolvedValue(undefined),
      closePublisher: vi.fn().mockResolvedValue(undefined),
      closeLockClient: vi.fn().mockResolvedValue(undefined),
      flushSentry: vi.fn().mockResolvedValue(undefined),
      captureError,
      exit,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    const signalShutdown = shutdown({ trigger: "SIGTERM" });
    await vi.waitFor(() => {
      expect(exit).not.toHaveBeenCalled();
    });

    await shutdown({
      trigger: "unhandledRejection",
      exitCode: 1,
      error: reason,
      timeoutMs: 5_000,
    });
    workerClose.resolve();
    await signalShutdown;

    expect(captureError).toHaveBeenCalledWith(reason);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("registerShutdownHandlers", () => {
  it("routes SIGTERM through graceful shutdown", async () => {
    const { process, emit } = createProcessMock();
    const shutdown: GracefulShutdownController["shutdown"] = vi.fn(
      async () => undefined,
    );

    registerShutdownHandlers({
      process,
      shutdown,
      captureError: vi.fn(),
      logger: { error: vi.fn() },
      uncaughtExceptionTimeoutMs: 5_000,
    });

    emit.signal("SIGTERM");

    await vi.waitFor(() => {
      expect(shutdown).toHaveBeenCalledWith({ trigger: "SIGTERM" });
    });
  });

  it("routes unhandled rejections through graceful shutdown", async () => {
    const { process, emit } = createProcessMock();
    const shutdown = vi.fn<(_: GracefulShutdownRequest) => Promise<void>>(
      async () => undefined,
    );
    const reason = new Error("rejected");

    registerShutdownHandlers({
      process,
      shutdown,
      captureError: vi.fn(),
      logger: { error: vi.fn() },
      uncaughtExceptionTimeoutMs: 5_000,
    });

    emit.unhandledRejection(reason);

    await vi.waitFor(() => {
      expect(shutdown).toHaveBeenCalledWith({
        trigger: "unhandledRejection",
        exitCode: 1,
        error: reason,
      });
    });
  });

  it("routes uncaught exceptions through graceful shutdown with the short timeout", async () => {
    const { process, emit } = createProcessMock();
    const shutdown = vi.fn<(_: GracefulShutdownRequest) => Promise<void>>(
      async () => undefined,
    );
    const captureError = vi.fn();
    const error = new Error("uncaught");

    registerShutdownHandlers({
      process,
      shutdown,
      captureError,
      logger: { error: vi.fn() },
      uncaughtExceptionTimeoutMs: 5_000,
    });

    emit.uncaughtException(error);

    expect(captureError).toHaveBeenCalledWith(error);
    await vi.waitFor(() => {
      expect(shutdown).toHaveBeenCalledWith({
        trigger: "uncaughtException",
        exitCode: 1,
        timeoutMs: 5_000,
      });
    });
  });
});
