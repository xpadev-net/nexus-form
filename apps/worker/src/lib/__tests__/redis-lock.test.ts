import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  set: vi.fn(),
  eval: vi.fn(),
  on: vi.fn(),
}));

vi.mock("ioredis", () => ({
  default: vi.fn(() => redisMock),
}));

vi.mock("./redis", () => ({
  getPublisherConnectionOptions: () => ({}),
}));

const { RedisLockAbortedError, withRedisLock } = await import("../redis-lock");

describe("withRedisLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.set.mockResolvedValue(null);
    redisMock.eval.mockResolvedValue(1);
  });

  it("stops retrying when the abort signal fires", async () => {
    const controller = new AbortController();
    const promise = withRedisLock("test-lock", async () => "ok", {
      waitTimeoutMs: 5_000,
      retryDelayMs: 500,
      signal: controller.signal,
    });

    controller.abort(new RedisLockAbortedError("test-lock"));
    await expect(promise).rejects.toBeInstanceOf(RedisLockAbortedError);
    expect(redisMock.set).toHaveBeenCalled();
  });
});
