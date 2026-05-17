import { describe, expect, it, vi } from "vitest";
import { deleteRedisKeysByPattern } from "../redis-key-cleanup";

describe("deleteRedisKeysByPattern", () => {
  it("deletes matching keys across scan pages without flushing the database", async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(["7", ["service:cache:github:a"]])
      .mockResolvedValueOnce([
        "0",
        ["service:cache:discord:b", "service:cache:twitter:c"],
      ]);
    const del = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const deleted = await deleteRedisKeysByPattern(
      { scan, del },
      "service:cache:*",
      100,
    );

    expect(deleted).toBe(3);
    expect(scan).toHaveBeenNthCalledWith(
      1,
      "0",
      "MATCH",
      "service:cache:*",
      "COUNT",
      100,
    );
    expect(scan).toHaveBeenNthCalledWith(
      2,
      "7",
      "MATCH",
      "service:cache:*",
      "COUNT",
      100,
    );
    expect(del).toHaveBeenNthCalledWith(1, "service:cache:github:a");
    expect(del).toHaveBeenNthCalledWith(
      2,
      "service:cache:discord:b",
      "service:cache:twitter:c",
    );
  });

  it("skips del calls for empty scan pages", async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(["3", []])
      .mockResolvedValueOnce(["0", ["service:cache:github:a"]]);
    const del = vi.fn().mockResolvedValueOnce(1);

    const deleted = await deleteRedisKeysByPattern(
      { scan, del },
      "service:cache:github:*",
    );

    expect(deleted).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("service:cache:github:a");
  });
});
