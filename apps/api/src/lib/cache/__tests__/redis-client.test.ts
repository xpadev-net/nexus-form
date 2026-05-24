import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redisConstructor: vi.fn(() => ({
    on: vi.fn(),
  })),
}));

vi.mock("ioredis", () => ({
  default: mocks.redisConstructor,
}));

vi.mock("../../logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const originalEnv = process.env;

function resetRedisEnv(): void {
  process.env = { ...originalEnv };
  delete process.env.REDIS_SENTINELS;
  delete process.env.REDIS_SENTINEL_MASTER_NAME;
  delete process.env.REDIS_SENTINEL_PASSWORD;
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_PASSWORD;
  delete process.env.REDIS_TLS;
}

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
  vi.clearAllMocks();
});

describe("getRedisClient", () => {
  it("passes REDIS_PASSWORD when REDIS_URL does not include a password", async () => {
    resetRedisEnv();
    process.env.REDIS_URL = "redis://redis-service:6379";
    process.env.REDIS_PASSWORD = "secret";

    const { getRedisClient } = await import("../redis-client");

    getRedisClient();

    expect(mocks.redisConstructor).toHaveBeenCalledWith(
      "redis://redis-service:6379",
      expect.objectContaining({
        password: "secret",
      }),
    );
  });

  it("does not override credentials embedded in REDIS_URL", async () => {
    resetRedisEnv();
    process.env.REDIS_URL = "redis://user%40name:p%40ss@redis-service:6379";
    process.env.REDIS_PASSWORD = "env-secret";

    const { getRedisClient } = await import("../redis-client");

    getRedisClient();

    expect(mocks.redisConstructor).toHaveBeenCalledWith(
      "redis://user%40name:p%40ss@redis-service:6379",
      expect.any(Object),
    );
    const call = mocks.redisConstructor.mock.calls[0] as
      | [string, Record<string, unknown>]
      | undefined;
    const options = call?.[1];
    expect(options).not.toEqual(
      expect.objectContaining({ password: expect.anything() }),
    );
    expect(options).not.toEqual(
      expect.objectContaining({ username: expect.anything() }),
    );
  });
});
