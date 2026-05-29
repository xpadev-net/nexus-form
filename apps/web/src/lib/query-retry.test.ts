import { describe, expect, it } from "vitest";
import { RpcError } from "./api";
import { shouldRetryQuery } from "./query-retry";

describe("shouldRetryQuery", () => {
  it("does not retry client errors", () => {
    expect(shouldRetryQuery(0, new RpcError("Bad request", 400))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Unauthorized", 401))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Forbidden", 403))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Not found", 404))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Conflict", 409))).toBe(false);
  });

  it("retries server and network errors up to the shared limit", () => {
    expect(shouldRetryQuery(2, new RpcError("Server error", 500))).toBe(true);
    expect(shouldRetryQuery(3, new RpcError("Server error", 500))).toBe(false);
    expect(shouldRetryQuery(2, new Error("Network"))).toBe(true);
    expect(shouldRetryQuery(3, new Error("Network"))).toBe(false);
  });
});
