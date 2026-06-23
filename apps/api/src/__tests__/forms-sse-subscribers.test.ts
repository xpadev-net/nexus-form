import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFormsSSERouter,
  createSseChannelRegistry,
  createSseConnectionLimiter,
} from "../routes/forms-sse";

const mocks = vi.hoisted(() => ({
  captureError: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/dual-auth", () => ({
  checkFormPermissionLevel: vi.fn(async () => undefined),
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

vi.mock("../lib/logger", () => ({
  logError: mocks.logError,
  logWarn: mocks.logWarn,
}));

vi.mock("../lib/sentry", () => ({
  captureError: mocks.captureError,
}));

type FakeMessageListener = (channel: string, message: string) => void;
type FakeErrorListener = (error: unknown) => void;

function isFakeMessageListener(
  event: "message" | "error",
  _listener: FakeMessageListener | FakeErrorListener,
): _listener is FakeMessageListener {
  return event === "message";
}

class FakeSubscriber {
  messageListeners: FakeMessageListener[] = [];
  errorListeners: FakeErrorListener[] = [];
  readonly subscribe = vi.fn(async (_channel: string) => undefined);
  readonly unsubscribe = vi.fn(async (_channel: string) => undefined);
  readonly quit = vi.fn(async () => undefined);

  on(event: "message", listener: FakeMessageListener): this;
  on(event: "error", listener: FakeErrorListener): this;
  on(
    event: "message" | "error",
    listener: FakeMessageListener | FakeErrorListener,
  ): this {
    if (isFakeMessageListener(event, listener)) {
      this.messageListeners.push(listener);
      return this;
    }
    this.errorListeners.push(listener);
    return this;
  }

  off(event: "message", listener: FakeMessageListener): this;
  off(event: "error", listener: FakeErrorListener): this;
  off(
    event: "message" | "error",
    listener: FakeMessageListener | FakeErrorListener,
  ): this {
    if (isFakeMessageListener(event, listener)) {
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

  emitMessage(channel: string, message: string): void {
    for (const listener of [...this.messageListeners]) {
      listener(channel, message);
    }
  }

  emitError(error: unknown): void {
    for (const listener of [...this.errorListeners]) {
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

function createClient() {
  return {
    sendMessage: vi.fn(async (_id: string, _data: string) => undefined),
    close: vi.fn(),
  };
}

describe("SSE channel subscriber registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    await vi.waitFor(() => {
      expect(firstClient.sendMessage).toHaveBeenCalledWith(
        "1",
        '{"type":"ok"}',
      );
      expect(secondClient.sendMessage).toHaveBeenCalledWith(
        "1",
        '{"type":"ok"}',
      );
    });

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

  it("does not double close when client close re-enters detach cleanup", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    let detachClient: (() => Promise<void>) | null = null;
    const client = {
      sendMessage: vi.fn(async (_id: string, _data: string) => undefined),
      close: vi.fn(() => {
        void detachClient?.();
      }),
    };

    detachClient = await registry.attach("form:validation:form-1", client);

    await registry.closeAll();
    await detachClient();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.messageListeners).toHaveLength(0);
    expect(subscribers[0]?.errorListeners).toHaveLength(0);
  });

  it("handles Redis subscriber errors by closing clients and cleaning listeners", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const client = createClient();

    const detach = await registry.attach("form:validation:form-1", client);

    expect(subscribers[0]?.messageListeners).toHaveLength(1);
    expect(subscribers[0]?.errorListeners).toHaveLength(1);

    const error = new Error("Redis subscriber connection lost");
    subscribers[0]?.emitError(error);

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.messageListeners).toHaveLength(0);
      expect(subscribers[0]?.errorListeners).toHaveLength(0);
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "SSE Redis subscriber error; closing clients and relying on EventSource retry",
      "api",
      { channel: "form:validation:form-1", error },
    );
    expect(mocks.captureError).toHaveBeenCalledWith(error);

    const nextClient = createClient();
    const detachNext = await registry.attach(
      "form:validation:form-1",
      nextClient,
    );

    expect(subscribers).toHaveLength(2);
    expect(subscribers[1]?.subscribe).toHaveBeenCalledWith(
      "form:validation:form-1",
    );

    await detach();
    await detachNext();
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("cleans Redis subscriber listeners when client close throws", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const closeError = new Error("client close failed");
    const client = {
      sendMessage: vi.fn(async (_id: string, _data: string) => undefined),
      close: vi.fn(() => {
        throw closeError;
      }),
    };

    const detach = await registry.attach("form:validation:form-1", client);

    const subscriberError = new Error("Redis subscriber connection lost");
    subscribers[0]?.emitError(subscriberError);

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.messageListeners).toHaveLength(0);
      expect(subscribers[0]?.errorListeners).toHaveLength(0);
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "SSE client close failed during subscription cleanup",
      "api",
      { channel: "form:validation:form-1", error: closeError },
    );
    expect(mocks.captureError).toHaveBeenCalledWith(subscriberError);

    await detach();
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("closes the last subscription when a revoked client close throws", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const closeError = new Error("client close failed");
    const client = {
      sendMessage: vi.fn(async (_id: string, _data: string) => undefined),
      close: vi.fn(() => {
        throw closeError;
      }),
    };

    const detach = await registry.attach("form:validation:form-1", client, {
      userId: "user-1",
    });

    subscribers[0]?.emitMessage(
      "form:validation:form-1",
      JSON.stringify({
        type: "sse_access_revoked",
        formId: "form-1",
        targetType: "user",
        userId: "user-1",
        timestamp: new Date().toISOString(),
      }),
    );

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.messageListeners).toHaveLength(0);
      expect(subscribers[0]?.errorListeners).toHaveLength(0);
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "SSE client close failed during subscription cleanup",
      "api",
      { channel: "form:validation:form-1", error: closeError },
    );

    await detach();
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
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

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
    });

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
      closeAccessRevoked: vi.fn(async () => 0),
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

  it("returns HTTP 503 when a subscriber error closes pending preflight subscribe", async () => {
    const subscribeReady = createDeferred();
    const release = vi.fn();
    const subscribers: FakeSubscriber[] = [];
    const channelRegistry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscriber.subscribe.mockImplementationOnce(async () => {
        await subscribeReady.promise;
      });
      subscribers.push(subscriber);
      return subscriber;
    });
    const connectionLimiter = {
      tryAcquire: vi.fn(() => ({ release })),
    };
    const router = createFormsSSERouter({
      channelRegistry,
      connectionLimiter,
    });

    const responsePromise = router.request(
      "http://localhost/form-1/responses/events",
    );
    await vi.waitFor(() => {
      expect(subscribers[0]?.subscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
    });

    const subscriberError = new Error("Redis subscriber connection lost");
    subscribers[0]?.emitError(subscriberError);
    await vi.waitFor(() => {
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
    });
    subscribeReady.resolve();

    const response = await responsePromise;

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "text/event-stream",
    );
    await expect(response.text()).resolves.toBe("SSE subscription unavailable");
    expect(release).toHaveBeenCalledTimes(1);
    expect(subscribers).toHaveLength(1);
    expect(mocks.captureError).toHaveBeenCalledWith(subscriberError);
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

  it("serializes consecutive Redis messages per client", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const firstSent = createDeferred();
    const secondSent = createDeferred();
    const thirdSent = createDeferred();
    const completedIds: string[] = [];
    const client = {
      sendMessage: vi.fn((id: string, _data: string) => {
        const deferred =
          id === "1" ? firstSent : id === "2" ? secondSent : thirdSent;
        return deferred.promise.then(() => {
          completedIds.push(id);
        });
      }),
      close: vi.fn(),
    };

    const detach = await registry.attach("form:validation:form-1", client);

    subscribers[0]?.emitMessage("form:validation:form-1", "first");
    subscribers[0]?.emitMessage("form:validation:form-1", "second");
    subscribers[0]?.emitMessage("form:validation:form-1", "third");

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(client.sendMessage).toHaveBeenNthCalledWith(1, "1", "first");

    firstSent.resolve();
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledTimes(2);
    });
    expect(client.sendMessage).toHaveBeenNthCalledWith(2, "2", "second");
    expect(completedIds).toEqual(["1"]);

    secondSent.resolve();
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledTimes(3);
    });
    expect(client.sendMessage).toHaveBeenNthCalledWith(3, "3", "third");
    expect(completedIds).toEqual(["1", "2"]);

    thirdSent.resolve();
    await vi.waitFor(() => {
      expect(completedIds).toEqual(["1", "2", "3"]);
    });

    await detach();
  });

  it("closes the last client subscription when a queued send fails", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const firstSent = createDeferred();
    const client = {
      sendMessage: vi.fn((id: string, _data: string) => {
        if (id === "1") return firstSent.promise;
        return Promise.resolve();
      }),
      close: vi.fn(),
    };

    const detach = await registry.attach("form:validation:form-1", client);

    subscribers[0]?.emitMessage("form:validation:form-1", "first");
    subscribers[0]?.emitMessage("form:validation:form-1", "second");

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
    });

    firstSent.reject(new Error("client disconnected"));

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
    });
    expect(client.sendMessage).toHaveBeenCalledTimes(1);

    await detach();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("closes a client when its pending send queue grows too large", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const firstSent = createDeferred();
    const client = {
      sendMessage: vi.fn((id: string, _data: string) => {
        if (id === "1") return firstSent.promise;
        return Promise.resolve();
      }),
      close: vi.fn(),
    };

    const detach = await registry.attach("form:validation:form-1", client);

    subscribers[0]?.emitMessage("form:validation:form-1", "message-0");
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
    });

    for (let i = 1; i <= 100; i++) {
      subscribers[0]?.emitMessage("form:validation:form-1", `message-${i}`);
    }

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
      expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
    });
    expect(client.sendMessage).toHaveBeenCalledTimes(1);

    firstSent.resolve();
    await detach();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.quit).toHaveBeenCalledTimes(1);
  });

  it("closes only the SSE client whose userId matches an access-revoke event", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const targetClient = createClient();
    const otherClient = createClient();

    await registry.attach("form:validation:form-1", targetClient, {
      userId: "user-1",
    });
    await registry.attach("form:validation:form-1", otherClient, {
      userId: "user-2",
    });

    subscribers[0]?.emitMessage(
      "form:validation:form-1",
      JSON.stringify({
        type: "sse_access_revoked",
        formId: "form-1",
        targetType: "user",
        userId: "user-1",
        timestamp: new Date().toISOString(),
      }),
    );

    await vi.waitFor(() => {
      expect(targetClient.close).toHaveBeenCalledTimes(1);
    });
    expect(otherClient.close).not.toHaveBeenCalled();
    expect(targetClient.sendMessage).not.toHaveBeenCalled();
  });

  it("ignores access-revoke events whose formId does not match the Redis channel", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const targetClient = createClient();

    await registry.attach("form:validation:form-1", targetClient, {
      userId: "user-1",
    });

    subscribers[0]?.emitMessage(
      "form:validation:form-1",
      JSON.stringify({
        type: "sse_access_revoked",
        formId: "form-2",
        targetType: "user",
        userId: "user-1",
        timestamp: new Date().toISOString(),
      }),
    );
    await Promise.resolve();

    expect(targetClient.close).not.toHaveBeenCalled();
  });

  it("closes only the SSE client whose shareLinkId matches an access-revoke event", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const targetClient = createClient();
    const otherShareLinkClient = createClient();
    const sessionClient = createClient();

    await registry.attach("form:validation:form-1", targetClient, {
      userId: "share-link:link-1",
      shareLinkId: "link-1",
    });
    await registry.attach("form:validation:form-1", otherShareLinkClient, {
      userId: "share-link:link-2",
      shareLinkId: "link-2",
    });
    await registry.attach("form:validation:form-1", sessionClient, {
      userId: "user-1",
    });

    subscribers[0]?.emitMessage(
      "form:validation:form-1",
      JSON.stringify({
        type: "sse_access_revoked",
        formId: "form-1",
        targetType: "share_link",
        shareLinkId: "link-1",
        timestamp: new Date().toISOString(),
      }),
    );

    await vi.waitFor(() => {
      expect(targetClient.close).toHaveBeenCalledTimes(1);
    });
    expect(otherShareLinkClient.close).not.toHaveBeenCalled();
    expect(sessionClient.close).not.toHaveBeenCalled();
    expect(targetClient.sendMessage).not.toHaveBeenCalled();
  });

  it("directly closes local clients for a form-wide access revoke", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const validationClient = createClient();
    const editorClient = createClient();
    const otherFormClient = createClient();

    await registry.attach("form:validation:form-1", validationClient, {
      userId: "user-1",
    });
    await registry.attach("form:editor:form-1", editorClient, {
      userId: "user-2",
    });
    await registry.attach("form:validation:form-2", otherFormClient, {
      userId: "user-3",
    });

    await expect(
      registry.closeAccessRevoked({
        type: "sse_access_revoked",
        formId: "form-1",
        targetType: "form",
        timestamp: new Date().toISOString(),
      }),
    ).resolves.toBe(2);

    expect(validationClient.close).toHaveBeenCalledTimes(1);
    expect(editorClient.close).toHaveBeenCalledTimes(1);
    expect(otherFormClient.close).not.toHaveBeenCalled();
  });

  it("holds normal messages until the SSE client activation check passes", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const activation = createDeferred();
    const client = createClient();

    const detach = await registry.attach("form:validation:form-1", client, {
      activation: activation.promise,
      userId: "share-link:link-1",
      shareLinkId: "link-1",
    });

    subscribers[0]?.emitMessage("form:validation:form-1", "before-activation");
    expect(client.sendMessage).not.toHaveBeenCalled();

    activation.resolve();
    await Promise.resolve();
    subscribers[0]?.emitMessage("form:validation:form-1", "after-activation");
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith("1", "after-activation");
    });

    await detach();
  });

  it("closes a client when its SSE activation check fails", async () => {
    const subscribers: FakeSubscriber[] = [];
    const registry = createSseChannelRegistry(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    });
    const activation = createDeferred();
    const client = createClient();

    const detach = await registry.attach("form:validation:form-1", client, {
      activation: activation.promise,
      userId: "share-link:link-1",
      shareLinkId: "link-1",
    });

    activation.reject(new Error("permission revoked"));

    await vi.waitFor(() => {
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(subscribers[0]?.unsubscribe).toHaveBeenCalledWith(
        "form:validation:form-1",
      );
    });

    await detach();
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
