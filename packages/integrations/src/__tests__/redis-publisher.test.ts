import { describe, expect, it, vi } from "vitest";
import { createRedisPublisher } from "../redis-publisher";

describe("createRedisPublisher", () => {
  it("lazily creates one client and publishes serialized events", async () => {
    const client = {
      on: vi.fn(),
      publish: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
    };
    const createClient = vi.fn(() => client);
    const onInit = vi.fn();
    const publisher = createRedisPublisher<{ formId: string; type: string }>({
      createClient,
      resolveChannel: (event) => `form:${event.formId}`,
      onInit,
      onConnectionError: vi.fn(),
      onPublishError: vi.fn(),
    });

    await publisher.publish({ formId: "form-1", type: "updated" });
    await publisher.publish({ formId: "form-2", type: "updated" });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(onInit).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client.publish).toHaveBeenNthCalledWith(
      1,
      "form:form-1",
      JSON.stringify({ formId: "form-1", type: "updated" }),
    );
    expect(client.publish).toHaveBeenNthCalledWith(
      2,
      "form:form-2",
      JSON.stringify({ formId: "form-2", type: "updated" }),
    );
  });

  it("skips publish when the app has no Redis client configured", async () => {
    const publisher = createRedisPublisher<{ formId: string }>({
      createClient: () => null,
      resolveChannel: (event) => `form:${event.formId}`,
      onConnectionError: vi.fn(),
      onPublishError: vi.fn(),
    });

    await expect(publisher.publish({ formId: "form-1" })).resolves.toBe(
      undefined,
    );
  });

  it("reports publish errors without throwing", async () => {
    const publishError = new Error("publish failed");
    const client = {
      on: vi.fn(),
      publish: vi.fn(async () => {
        throw publishError;
      }),
      quit: vi.fn(async () => undefined),
    };
    const onPublishError = vi.fn();
    const publisher = createRedisPublisher<{ formId: string }>({
      createClient: () => client,
      resolveChannel: (event) => `form:${event.formId}`,
      onConnectionError: vi.fn(),
      onPublishError,
    });
    const event = { formId: "form-1" };

    await publisher.publish(event);

    expect(onPublishError).toHaveBeenCalledWith(publishError, event);
  });

  it("reports and rethrows close errors by default", async () => {
    const closeError = new Error("close failed");
    const client = {
      on: vi.fn(),
      publish: vi.fn(async () => undefined),
      quit: vi.fn(async () => {
        throw closeError;
      }),
    };
    const onCloseError = vi.fn();
    const publisher = createRedisPublisher<{ formId: string }>({
      createClient: () => client,
      resolveChannel: (event) => `form:${event.formId}`,
      onConnectionError: vi.fn(),
      onPublishError: vi.fn(),
      onCloseError,
    });

    await publisher.publish({ formId: "form-1" });
    await expect(publisher.close()).rejects.toThrow(closeError);

    expect(onCloseError).toHaveBeenCalledWith(closeError);
  });

  it("can report close errors without throwing", async () => {
    const closeError = new Error("close failed");
    const client = {
      on: vi.fn(),
      publish: vi.fn(async () => undefined),
      quit: vi.fn(async () => {
        throw closeError;
      }),
    };
    const onCloseError = vi.fn();
    const publisher = createRedisPublisher<{ formId: string }>({
      createClient: () => client,
      resolveChannel: (event) => `form:${event.formId}`,
      onConnectionError: vi.fn(),
      onPublishError: vi.fn(),
      onCloseError,
      swallowCloseError: true,
    });

    await publisher.publish({ formId: "form-1" });
    await expect(publisher.close()).resolves.toBe(undefined);

    expect(onCloseError).toHaveBeenCalledWith(closeError);
  });
});
