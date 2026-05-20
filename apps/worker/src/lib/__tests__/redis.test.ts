import { afterEach, describe, expect, it, vi } from "vitest";

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
});

describe("worker Redis connection options", () => {
  it("uses REDIS_PASSWORD when REDIS_URL does not include a password", async () => {
    resetRedisEnv();
    process.env.REDIS_URL = "redis://redis-service:6379";
    process.env.REDIS_PASSWORD = "secret";
    vi.resetModules();

    const { getPublisherConnectionOptions, redisConnection } = await import(
      "../redis"
    );

    expect(redisConnection).toEqual(
      expect.objectContaining({
        host: "redis-service",
        port: 6379,
        password: "secret",
      }),
    );
    expect(getPublisherConnectionOptions().password).toBe("secret");
  });

  it("prefers the password embedded in REDIS_URL", async () => {
    resetRedisEnv();
    process.env.REDIS_URL = "redis://:url-secret@redis-service:6379";
    process.env.REDIS_PASSWORD = "env-secret";
    vi.resetModules();

    const { redisConnection } = await import("../redis");

    expect(redisConnection.password).toBe("url-secret");
  });
});
