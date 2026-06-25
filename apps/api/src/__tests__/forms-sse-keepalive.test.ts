import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let keepaliveWriteShouldFail = false;

const errorMocks = vi.hoisted(() => ({
  captureError: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

type StreamLike = {
  onAbort: (callback: () => void) => void;
  abort: () => void;
  close: () => void;
  writeSSE: (payload: { event?: string; data?: string }) => Promise<void>;
};

const streamMock: {
  onAbort: ReturnType<typeof vi.fn<StreamLike["onAbort"]>>;
  abort: ReturnType<typeof vi.fn<StreamLike["abort"]>>;
  close: ReturnType<typeof vi.fn<StreamLike["close"]>>;
  writeSSE: ReturnType<typeof vi.fn<StreamLike["writeSSE"]>>;
} = {
  onAbort: vi.fn<StreamLike["onAbort"]>(),
  abort: vi.fn<StreamLike["abort"]>(),
  close: vi.fn<StreamLike["close"]>(),
  writeSSE: vi.fn<StreamLike["writeSSE"]>(),
};

const checkFormPermissionLevel = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../lib/logger", () => ({
  logError: errorMocks.logError,
  logWarn: errorMocks.logWarn,
}));

vi.mock("../lib/sentry", () => ({
  captureError: errorMocks.captureError,
}));

vi.mock("hono/streaming", async () => {
  const actual =
    await vi.importActual<typeof import("hono/streaming")>("hono/streaming");
  return {
    ...actual,
    streamSSE: vi.fn(
      async (
        _context: unknown,
        handler: (stream: StreamLike) => Promise<void>,
      ) => {
        let onAbort: (() => void) | null = null;
        streamMock.onAbort.mockImplementation((callback: () => void) => {
          onAbort = callback;
        });
        streamMock.abort.mockImplementation(() => {
          onAbort?.();
        });
        streamMock.close.mockImplementation(() => {
          // stream close callback should be non-blocking in tests
        });
        streamMock.writeSSE.mockImplementation(
          async (payload: { event?: string }) => {
            if (payload.event === "keepalive" && keepaliveWriteShouldFail) {
              throw new Error("keepalive write failed");
            }
          },
        );

        await handler(streamMock);
        return new Response("ok");
      },
    ),
  };
});

vi.mock("../lib/dual-auth", () => ({
  checkFormPermissionLevel,
  withDualFormAuth:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", { user_id: "user-1" });
      await next();
    },
}));

import {
  createFormsSSERouter,
  createSseChannelRegistry,
} from "../routes/forms-sse";

function assertFunction(
  listener: unknown,
): asserts listener is (...args: unknown[]) => void {
  if (typeof listener !== "function") {
    throw new TypeError("Expected listener function");
  }
}

class FakeSubscriber {
  messageListeners: Array<(channel: string, message: string) => void> = [];
  errorListeners: Array<(error: Error) => void> = [];
  readonly subscribe = vi.fn(async (_channel: string) => undefined);
  readonly unsubscribe = vi.fn(async (_channel: string) => undefined);
  readonly quit = vi.fn(async () => undefined);

  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "message" | "error", listener: unknown): this {
    assertFunction(listener);
    if (event === "message") {
      this.messageListeners.push(listener);
      return this;
    }

    this.errorListeners.push(listener);
    return this;
  }

  off(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): this;
  off(event: "error", listener: (error: Error) => void): this;
  off(
    event: "message" | "error",
    listener:
      | ((channel: string, message: string) => void)
      | ((error: Error) => void),
  ): this {
    if (event === "message") {
      this.messageListeners = this.messageListeners.filter(
        (currentListener) => currentListener !== listener,
      );
      return this;
    }

    this.errorListeners = this.errorListeners.filter(
      (currentListener) => currentListener !== listener,
    );
    return this;
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SSE keepalive handling", () => {
  beforeEach(() => {
    keepaliveWriteShouldFail = false;
    streamMock.onAbort.mockReset();
    streamMock.abort.mockReset();
    streamMock.close.mockReset();
    streamMock.writeSSE.mockReset();
    checkFormPermissionLevel.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("releases permit and closes client when keepalive write fails", async () => {
    const release = vi.fn();
    const detach = vi.fn(async () => undefined);
    const channelRegistry = {
      ensureSubscribed: vi.fn(async () => Symbol("preflight")),
      attach: vi.fn(async () => detach),
      closeAccessRevoked: vi.fn(async () => 0),
      closeAll: vi.fn(async () => undefined),
    };
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({
        release,
      })),
    };

    keepaliveWriteShouldFail = true;

    const responsePromise = createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    }).request("http://localhost/form-1/responses/events");

    await vi.advanceTimersByTimeAsync(30_000);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(release).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(streamMock.close).toHaveBeenCalledTimes(1);
    expect(streamMock.writeSSE).toHaveBeenCalledWith({
      event: "keepalive",
      data: "",
    });
  });

  it("detaches the Redis channel when keepalive write fails", async () => {
    const release = vi.fn();
    const subscribers: FakeSubscriber[] = [];
    const channelRegistry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({
        release,
      })),
    };

    const responsePromise = createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    }).request("http://localhost/form-1/responses/events");

    await vi.waitFor(() => {
      expect(subscribers).toHaveLength(1);
      expect(streamMock.onAbort).toHaveBeenCalledTimes(1);
    });

    keepaliveWriteShouldFail = true;
    await vi.advanceTimersByTimeAsync(30_000);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(release).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.messageListeners).toHaveLength(0);
    expect(subscribers[0]?.errorListeners).toHaveLength(0);
  });

  it("releases permit and closes client when post-subscribe permission recheck fails", async () => {
    const release = vi.fn();
    const detach = vi.fn(async () => undefined);
    const channelRegistry = {
      ensureSubscribed: vi.fn(async () => Symbol("preflight")),
      attach: vi.fn(async () => detach),
      closeAccessRevoked: vi.fn(async () => 0),
      closeAll: vi.fn(async () => undefined),
    };
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({
        release,
      })),
    };
    checkFormPermissionLevel.mockRejectedValueOnce(
      new Error("permission revoked"),
    );

    const response = await createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    }).request("http://localhost/form-1/responses/events");

    expect(response.status).toBe(200);
    expect(channelRegistry.attach).toHaveBeenCalledWith(
      "form:validation:form-1",
      expect.any(Object),
      expect.objectContaining({
        activation: expect.any(Promise),
        preflighted: true,
        userId: "user-1",
      }),
    );
    expect(checkFormPermissionLevel).toHaveBeenCalledWith(
      { user_id: "user-1" },
      "form-1",
      "EDITOR",
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(streamMock.close).toHaveBeenCalledTimes(1);
    expect(streamMock.writeSSE).not.toHaveBeenCalled();
  });

  it("releases permit when a Redis subscriber error closes the stream", async () => {
    const release = vi.fn();
    const quitReady = createDeferred();
    let quitContinued = false;
    const subscribers: FakeSubscriber[] = [];
    const channelRegistry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({
        release,
      })),
    };
    const responsePromise = createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    }).request("http://localhost/form-1/responses/events");

    await vi.waitFor(() => {
      expect(subscribers).toHaveLength(1);
      expect(streamMock.onAbort).toHaveBeenCalledTimes(1);
    });

    subscribers[0]?.quit.mockImplementationOnce(async () => {
      await quitReady.promise;
      quitContinued = true;
    });
    const error = new Error("Redis subscriber disconnected");
    subscribers[0]?.emitError(error);

    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledTimes(1);
      expect(streamMock.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
    });
    expect(quitContinued).toBe(false);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );

    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(errorMocks.logError).toHaveBeenCalledWith(
      "SSE Redis subscriber error; closing SSE clients so EventSource can reconnect",
      "service",
      {
        channel: "form:validation:form-1",
        clientCount: 1,
        error,
      },
    );
    expect(errorMocks.captureError).toHaveBeenCalledWith(error);

    quitReady.resolve();
    await vi.waitFor(() => {
      expect(quitContinued).toBe(true);
    });
  });
});
