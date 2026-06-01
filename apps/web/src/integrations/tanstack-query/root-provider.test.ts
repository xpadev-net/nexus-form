import { describe, expect, it } from "vitest";
import { RpcError } from "@/lib/api";
import { HttpError, NetworkError } from "@/lib/fetch-json";
import { queryClient } from "./root-provider";

describe("queryClient", () => {
  it("does not retry non-retryable query failures by default", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;

    expect(typeof retry).toBe("function");
    if (typeof retry !== "function") {
      throw new Error("query retry default is not configured");
    }

    expect(retry(0, new RpcError("Forbidden", 403))).toBe(false);
    expect(retry(0, new HttpError(404, "Not found"))).toBe(false);
    expect(retry(0, new HttpError(413, "Payload too large"))).toBe(false);
    expect(retry(2, new RpcError("Server error", 500))).toBe(true);
    expect(retry(2, new HttpError(503, "Unavailable"))).toBe(true);
    expect(
      retry(2, new NetworkError("Network request failed", new TypeError())),
    ).toBe(true);
    expect(retry(0, new Error("Unexpected parse failure"))).toBe(false);
    expect(retry(0, new TypeError("Cannot read properties of undefined"))).toBe(
      false,
    );
    expect(
      retry(3, new NetworkError("Network request failed", new TypeError())),
    ).toBe(false);
  });
});
