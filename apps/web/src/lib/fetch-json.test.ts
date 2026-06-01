import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, NetworkError } from "./fetch-json";

describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps fetch failures as network errors", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
    const request = fetchJson("/api/example");

    await expect(request).rejects.toBeInstanceOf(NetworkError);
    await expect(request).rejects.toMatchObject({
      cause,
      message: "Network request failed",
      name: "NetworkError",
    } satisfies Partial<NetworkError>);
  });

  it("does not wrap aborted fetches as network errors", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(fetchJson("/api/example")).rejects.toBe(abortError);
  });
});
