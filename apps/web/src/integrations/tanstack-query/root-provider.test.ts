import { describe, expect, it } from "vitest";
import { RpcError } from "@/lib/api";
import { queryClient } from "./root-provider";

describe("queryClient", () => {
  it("does not retry 4xx query failures by default", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;

    expect(typeof retry).toBe("function");
    if (typeof retry !== "function") {
      throw new Error("query retry default is not configured");
    }

    expect(retry(0, new RpcError("Forbidden", 403))).toBe(false);
    expect(retry(2, new RpcError("Server error", 500))).toBe(true);
    expect(retry(3, new Error("Network"))).toBe(false);
  });
});
