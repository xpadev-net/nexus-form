import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeLocalSseConnectionsForAccessRevoked: vi.fn(async () => 0),
  getRedisConnection: vi.fn(() => ({
    connection: {
      enableOfflineQueue: true,
      host: "127.0.0.1",
      maxRetriesPerRequest: null,
      port: 6379,
    },
  })),
  logError: vi.fn(),
  logInfo: vi.fn(),
  redisClient: {
    on: vi.fn(),
    publish: vi.fn(async (_channel: string, _message: string) => undefined),
    quit: vi.fn(async () => undefined),
  },
}));

vi.mock("ioredis", () => ({
  default: vi.fn(function Redis() {
    return mocks.redisClient;
  }),
}));

vi.mock("../logger", () => ({
  logError: mocks.logError,
  logInfo: mocks.logInfo,
}));

vi.mock("../redis", () => ({
  getRedisConnection: mocks.getRedisConnection,
}));

vi.mock("../../routes/forms-sse", () => ({
  closeLocalSseConnectionsForAccessRevoked:
    mocks.closeLocalSseConnectionsForAccessRevoked,
}));

import { publishSseAccessRevoked } from "../redis-publisher";

const originalRedisUrl = process.env.REDIS_URL;
const originalRedisHost = process.env.REDIS_HOST;
const originalRedisSentinels = process.env.REDIS_SENTINELS;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("publishSseAccessRevoked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = "";
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.REDIS_SENTINELS = "";
    mocks.closeLocalSseConnectionsForAccessRevoked.mockResolvedValue(1);
    mocks.redisClient.publish.mockRejectedValue(new Error("redis down"));
    mocks.redisClient.quit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreEnv("REDIS_URL", originalRedisUrl);
    restoreEnv("REDIS_HOST", originalRedisHost);
    restoreEnv("REDIS_SENTINELS", originalRedisSentinels);
  });

  it("closes local SSE clients before reporting Redis publish failure", async () => {
    await expect(
      publishSseAccessRevoked("form-1", {
        targetType: "share_link",
        shareLinkId: "link-1",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.closeLocalSseConnectionsForAccessRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        shareLinkId: "link-1",
        targetType: "share_link",
        type: "sse_access_revoked",
      }),
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledWith(
      "form:editor:form-1",
      expect.stringContaining('"targetType":"share_link"'),
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledWith(
      "form:validation:form-1",
      expect.stringContaining('"shareLinkId":"link-1"'),
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledWith(
      "form:validation:form-1",
      expect.stringContaining('"userId":"share-link:link-1"'),
    );

    const closeOrder =
      mocks.closeLocalSseConnectionsForAccessRevoked.mock
        .invocationCallOrder[0];
    const publishOrder = mocks.redisClient.publish.mock.invocationCallOrder[0];
    if (closeOrder === undefined || publishOrder === undefined) {
      throw new Error("Expected local close and Redis publish to be called");
    }
    expect(closeOrder).toBeLessThan(publishOrder);

    expect(mocks.logError).toHaveBeenCalledWith(
      "Failed to publish SSE access revoke event",
      "service",
      expect.objectContaining({
        closedLocalConnections: 1,
        error: "redis down",
        formId: "form-1",
        shareLinkId: "link-1",
        targetType: "share_link",
      }),
    );
    expect(mocks.redisClient.quit).toHaveBeenCalledTimes(1);
  });
});
