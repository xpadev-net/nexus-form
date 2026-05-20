import { afterEach, describe, expect, it, vi } from "vitest";
import { getRedisConnection, getRedisConnectionInfo } from "../redis";

vi.mock("../logger", () => ({
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
});

describe("getRedisConnection", () => {
  it("uses REDIS_PASSWORD when REDIS_URL does not include a password", () => {
    resetRedisEnv();
    process.env.REDIS_URL = "redis://redis-service:6379";
    process.env.REDIS_PASSWORD = "secret";

    const { connection } = getRedisConnection();

    expect(connection).toEqual(
      expect.objectContaining({
        host: "redis-service",
        port: 6379,
        password: "secret",
      }),
    );
    expect(getRedisConnectionInfo().config.hasPassword).toBe(true);
  });

  it("prefers the password embedded in REDIS_URL", () => {
    resetRedisEnv();
    process.env.REDIS_URL = "redis://:url-secret@redis-service:6379";
    process.env.REDIS_PASSWORD = "env-secret";

    const { connection } = getRedisConnection();

    expect(connection.password).toBe("url-secret");
  });
});
