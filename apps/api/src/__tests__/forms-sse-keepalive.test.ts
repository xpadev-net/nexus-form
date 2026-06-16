import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let keepaliveWriteShouldFail = false;

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

import { createFormsSSERouter } from "../routes/forms-sse";

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
      ensureSubscribed: vi.fn(async () => undefined),
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

  it("releases permit and closes client when post-subscribe permission recheck fails", async () => {
    const release = vi.fn();
    const detach = vi.fn(async () => undefined);
    const channelRegistry = {
      ensureSubscribed: vi.fn(async () => undefined),
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
});
