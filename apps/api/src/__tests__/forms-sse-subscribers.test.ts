import { describe, expect, it, vi } from "vitest";
import {
  createFormsSSERouter,
  createSseChannelRegistry,
  createSseConnectionLimiter,
} from "../routes/forms-sse";

vi.mock("../lib/dual-auth", () => ({
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

class FakeSubscriber {
  readonly messageListeners: Array<(channel: string, message: string) => void> =
    [];
  readonly subscribe = vi.fn(async (_channel: string) => undefined);
  readonly unsubscribe = vi.fn(async (_channel: string) => undefined);
  readonly quit = vi.fn(async () => undefined);

  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): this {
    if (event === "message") {
      this.messageListeners.push(listener);
    }
    return this;
  }

  emitMessage(channel: string, message: string): void {
    for (const listener of this.messageListeners) {
      listener(channel, message);
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

function createClient() {
  return {
    sendMessage: vi.fn(async (_id: string, _data: string) => undefined),
    close: vi.fn(),
  };
}

describe("SSE channel subscriber registry", () => {
  it("reuses one Redis subscriber for multiple clients on the same channel", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const firstClient = createClient();
    const secondClient = createClient();

    const detachFirst = await registry.attach(
      "form:validation:form-1",
      firstClient,
    );
    const detachSecond = await registry.attach(
      "form:validation:form-1",
      secondClient,
    );

    expect(subscribers).toHaveLength(1);
    expect(subscribers[0]?.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.subscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );

    subscribers[0]?.emitMessage("form:validation:form-1", '{"type":"ok"}');

    expect(firstClient.sendMessage).toHaveBeenCalledWith("1", '{"type":"ok"}');
    expect(secondClient.sendMessage).toHaveBeenCalledWith("1", '{"type":"ok"}');

    await detachFirst();
    expect(subscribers[0]?.unsubscribe).not.toHaveBeenCalled();
    expect(subscribers[0]?.quit).not.toHaveBeenCalled();

    await detachSecond();
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("keeps subscribers isolated per channel", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });

    await registry.attach("form:validation:form-1", createClient());
    await registry.attach("form:validation:form-2", createClient());

    expect(subscribers).toHaveLength(2);
    expect(
      subscribers.map((subscriber) => subscriber.subscribe.mock.calls),
    ).toEqual([[["form:validation:form-1"]], [["form:validation:form-2"]]]);
  });

  it("closes all active subscribers during shutdown", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });

    await registry.attach("form:validation:form-1", createClient());
    await registry.attach("form:editor:form-1", createClient());

    await registry.closeAll();

    expect(subscribers).toHaveLength(2);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );
    expect(subscribers[1]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[1]?.unsubscribe).toHaveBeenCalledWith(
      "form:editor:form-1",
    );
    expect(
      subscribers.every(
        (subscriber) => subscriber.quit.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("signals active clients before closing subscribers during shutdown", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const firstClient = createClient();
    const secondClient = createClient();

    await registry.attach("form:validation:form-1", firstClient);
    await registry.attach("form:validation:form-1", secondClient);

    await registry.closeAll();

    expect(firstClient.close).toHaveBeenCalledTimes(1);
    expect(secondClient.close).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("preserves shutdown close signals while subscribe is still pending", async () => {
    const subscribeReady = createDeferred();
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscriber.subscribe.mockImplementationOnce(async () => {
        await subscribeReady.promise;
      });
      subscribers.push(subscriber);
      return subscriber;
    });
    const client = createClient();

    const attachPromise = registry.attach("form:validation:form-1", client);
    await vi.waitFor(() => {
      expect(subscribers[0]?.subscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
    });

    const closeAllPromise = registry.closeAll();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );

    subscribeReady.resolve();
    const detach = await attachPromise;
    await closeAllPromise;
    await detach();

    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("rejects new clients after shutdown has started", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });

    await registry.closeAll();
    const client = createClient();
    const detach = await registry.attach("form:validation:form-1", client);
    await detach();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(subscribers).toHaveLength(0);
  });

  it("returns HTTP 503 before opening an SSE stream when subscribe fails", async () => {
    const release = vi.fn();
    const channelRegistry = {
      ensureSubscribed: vi.fn(async () => {
        throw new Error("Redis subscribe failed");
      }),
      attach: vi.fn(),
      closeAll: vi.fn(async () => undefined),
    };
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({ release })),
    };
    const router = createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    });

    const response = await router.request(
      "http://localhost/form-1/responses/events",
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "text/event-stream",
    );
    await expect(response.text()).resolves.toBe("SSE subscription unavailable");
    expect(channelRegistry.ensureSubscribed).toHaveBeenCalledWith(
      "form:validation:form-1",
    );
    expect(channelRegistry.attach).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not create a subscriber for router requests after shutdown starts", async () => {
    const release = vi.fn();
    const subscribers: FakeSubscriber[] = [];
    const channelRegistry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({ release })),
    };
    await channelRegistry.closeAll();
    const router = createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    });

    const response = await router.request(
      "http://localhost/form-1/responses/events",
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("SSE subscription unavailable");
    expect(subscribers).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("SSE connection limiter", () => {
  it("limits connections per user so one user cannot occupy every process-local slot", () => {
    const limiter = createSseConnectionLimiter({
      maxTotal: 10,
      maxPerUser: 2,
      maxPerForm: 10,
    });

    const first = limiter.tryAcquire({ userId: "user-1", formId: "form-1" });
    const second = limiter.tryAcquire({ userId: "user-1", formId: "form-2" });
    const rejected = limiter.tryAcquire({
      userId: "user-1",
      formId: "form-3",
    });

    expect("release" in first).toBe(true);
    expect("release" in second).toBe(true);
    expect(rejected).toEqual({
      status: 503,
      message: "Too many SSE connections for this user",
    });

    if ("release" in first) first.release();

    const afterRelease = limiter.tryAcquire({
      userId: "user-1",
      formId: "form-3",
    });

    expect("release" in afterRelease).toBe(true);
  });

  it("limits connections per form independently from the total process limit", () => {
    const limiter = createSseConnectionLimiter({
      maxTotal: 10,
      maxPerUser: 10,
      maxPerForm: 2,
    });

    const first = limiter.tryAcquire({ userId: "user-1", formId: "form-1" });
    const second = limiter.tryAcquire({ userId: "user-2", formId: "form-1" });
    const rejected = limiter.tryAcquire({
      userId: "user-3",
      formId: "form-1",
    });

    expect("release" in first).toBe(true);
    expect("release" in second).toBe(true);
    expect(rejected).toEqual({
      status: 503,
      message: "Too many SSE connections for this form",
    });
  });

  it("keeps the process-local total limit as the final resource guard", () => {
    const limiter = createSseConnectionLimiter({
      maxTotal: 2,
      maxPerUser: 10,
      maxPerForm: 10,
    });

    limiter.tryAcquire({ userId: "user-1", formId: "form-1" });
    limiter.tryAcquire({ userId: "user-2", formId: "form-2" });

    expect(limiter.tryAcquire({ userId: "user-3", formId: "form-3" })).toEqual({
      status: 503,
      message: "Too many SSE connections",
    });
  });
});
