import { describe, expect, it } from "vitest";
import { RpcError } from "./api";
import { HttpError, NetworkError } from "./fetch-json";
import { shouldRetryQuery } from "./query-retry";

describe("shouldRetryQuery", () => {
  it("does not retry client errors", () => {
    expect(shouldRetryQuery(0, new RpcError("Bad request", 400))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Unauthorized", 401))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Forbidden", 403))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Not found", 404))).toBe(false);
    expect(shouldRetryQuery(0, new RpcError("Conflict", 409))).toBe(false);
    expect(shouldRetryQuery(0, new HttpError(422, "Validation failed"))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new HttpError(429, "Too many requests"))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new HttpError(600, "Unexpected status"))).toBe(
      false,
    );
  });

  it("retries server and fetch network errors up to the shared limit", () => {
    expect(shouldRetryQuery(2, new RpcError("Server error", 500))).toBe(true);
    expect(shouldRetryQuery(3, new RpcError("Server error", 500))).toBe(false);
    expect(shouldRetryQuery(2, new HttpError(502, "Bad gateway"))).toBe(true);
    expect(shouldRetryQuery(3, new HttpError(502, "Bad gateway"))).toBe(false);
    expect(shouldRetryQuery(2, new HttpError(503, "Unavailable"))).toBe(true);
    expect(shouldRetryQuery(3, new HttpError(503, "Unavailable"))).toBe(false);
    expect(
      shouldRetryQuery(
        2,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(true);
    expect(
      shouldRetryQuery(
        3,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(false);
  });

  it("does not retry non-network runtime errors or unknown error shapes", () => {
    expect(shouldRetryQuery(0, new Error("Unexpected parse failure"))).toBe(
      false,
    );
    expect(
      shouldRetryQuery(0, new TypeError("Cannot read properties of undefined")),
    ).toBe(false);
    expect(shouldRetryQuery(0, new DOMException("Aborted", "AbortError"))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, { status: 409 })).toBe(false);
  });

  it("does not mutate or replace errors with existing details", () => {
    const details = { code: "invalid" };
    const error = new RpcError("Invalid input", 422, details);

    expect(shouldRetryQuery(0, error)).toBe(false);
    expect(error.details).toBe(details);
  });
});
