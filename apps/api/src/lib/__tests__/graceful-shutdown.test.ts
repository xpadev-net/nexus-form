import { describe, expect, it, vi } from "vitest";
import {
  type ApiGracefulShutdownController,
  type ApiGracefulShutdownRequest,
  createApiGracefulShutdown,
  registerApiShutdownHandlers,
} from "../graceful-shutdown";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createProcessEmitter() {
  const signalHandlers = new Map<"SIGTERM" | "SIGINT", () => void>();
  let rejectionHandler: ((reason: unknown) => void) | undefined;
  let exceptionHandler: ((error: Error) => void) | undefined;

  return {
    process: {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        if (event === "SIGTERM" || event === "SIGINT") {
          signalHandlers.set(event, listener as () => void);
        }
        if (event === "unhandledRejection") {
          rejectionHandler = listener as (reason: unknown) => void;
        }
        if (event === "uncaughtException") {
          exceptionHandler = listener as (error: Error) => void;
        }
      }),
    },
    emit: {
      signal: (event: "SIGTERM" | "SIGINT") => signalHandlers.get(event)?.(),
      rejection: (reason: unknown) => rejectionHandler?.(reason),
      exception: (error: Error) => exceptionHandler?.(error),
    },
  };
}

describe("createApiGracefulShutdown", () => {
  it("closes the HTTP server before shared resources and exits cleanly", async () => {
    const events: string[] = [];
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        events.push("server");
        callback();
      }),
    };
    const stopServiceMonitor = vi.fn(() => events.push("monitor"));
    const stopPluginDriftGuard = vi
      .fn()
      .mockImplementation(async () => events.push("plugin"));
    const closeQueues = vi
      .fn()
      .mockImplementation(async () => events.push("queues"));
    const closePublisher = vi
      .fn()
      .mockImplementation(async () => events.push("publisher"));
    const closeRedisClient = vi
      .fn()
      .mockImplementation(async () => events.push("redis"));
    const closeDatabase = vi
      .fn()
      .mockImplementation(async () => events.push("database"));
    const flushSentry = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const { shutdown } = createApiGracefulShutdown({
      server,
      timeoutMs: 30_000,
      stopServiceMonitor,
      stopPluginDriftGuard,
      closeQueues,
      closePublisher,
      closeRedisClient,
      closeDatabase,
      flushSentry,
      captureError: vi.fn(),
      exit,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await shutdown({ trigger: "SIGTERM" });

    expect(stopServiceMonitor).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(closeQueues).toHaveBeenCalledTimes(1);
    expect(closePublisher).toHaveBeenCalledTimes(1);
    expect(closeRedisClient).toHaveBeenCalledTimes(1);
    expect(stopPluginDriftGuard).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(flushSentry).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(events[0]).toBe("server");
    expect(events[1]).toBe("monitor");
    expect(events.at(-1)).toBe("database");
  });

  it("continues closing later resources when one cleanup step fails", async () => {
    const shutdownError = new Error("queue close failed");
    const closeQueues = vi.fn().mockRejectedValue(shutdownError);
    const closePublisher = vi.fn().mockResolvedValue(undefined);
    const closeRedisClient = vi.fn().mockResolvedValue(undefined);
    const closeDatabase = vi.fn().mockResolvedValue(undefined);
    const flushSentry = vi.fn().mockResolvedValue(undefined);
    const captureError = vi.fn();
    const exit = vi.fn();

    const { shutdown } = createApiGracefulShutdown({
      server: {
        close: vi.fn((callback: (error?: Error) => void) => callback()),
      },
      timeoutMs: 30_000,
      stopServiceMonitor: vi.fn(),
      closeQueues,
      closePublisher,
      closeRedisClient,
      closeDatabase,
      flushSentry,
      captureError,
      exit,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await shutdown({ trigger: "SIGTERM" });

    expect(captureError).toHaveBeenCalledWith(shutdownError);
    expect(closePublisher).toHaveBeenCalledTimes(1);
    expect(closeRedisClient).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(flushSentry).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("is idempotent and escalates exit code when a fatal event arrives during shutdown", async () => {
    const serverClose = createDeferred();
    const exit = vi.fn();
    const captureError = vi.fn();
    const { shutdown } = createApiGracefulShutdown({
      server: {
        close: vi.fn((callback: (error?: Error) => void) => {
          void serverClose.promise.then(() => callback());
        }),
      },
      timeoutMs: 30_000,
      stopServiceMonitor: vi.fn(),
      closeQueues: vi.fn().mockResolvedValue(undefined),
      closePublisher: vi.fn().mockResolvedValue(undefined),
      closeRedisClient: vi.fn().mockResolvedValue(undefined),
      closeDatabase: vi.fn().mockResolvedValue(undefined),
      flushSentry: vi.fn().mockResolvedValue(undefined),
      captureError,
      exit,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    const signalShutdown = shutdown({ trigger: "SIGTERM" });
    await shutdown({
      trigger: "unhandledRejection",
      exitCode: 1,
      error: new Error("fatal"),
    });
    serverClose.resolve();
    await signalShutdown;

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("registerApiShutdownHandlers", () => {
  it("routes SIGTERM through graceful shutdown", async () => {
    const { process, emit } = createProcessEmitter();
    const shutdown: ApiGracefulShutdownController["shutdown"] = vi.fn(
      async () => undefined,
    );

    registerApiShutdownHandlers({
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

  it("routes uncaught exceptions through graceful shutdown with a short timeout", async () => {
    const { process, emit } = createProcessEmitter();
    const shutdown = vi.fn<(_: ApiGracefulShutdownRequest) => Promise<void>>(
      async () => undefined,
    );
    const captureError = vi.fn();
    const error = new Error("boom");

    registerApiShutdownHandlers({
      process,
      shutdown,
      captureError,
      logger: { error: vi.fn() },
      uncaughtExceptionTimeoutMs: 5_000,
    });

    emit.exception(error);

    await vi.waitFor(() => {
      expect(captureError).toHaveBeenCalledWith(error);
      expect(shutdown).toHaveBeenCalledWith({
        trigger: "uncaughtException",
        exitCode: 1,
        timeoutMs: 5_000,
      });
    });
  });
});
