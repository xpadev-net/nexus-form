import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, NetworkError } from "@/lib/fetch-json";
import { shouldRetryQuery } from "@/lib/query-retry";
import {
  captureRejection,
  stubFetchFailure,
  stubFetchResponse,
} from "@/lib/test-utils/fetch-helpers";
import { fetchValidationProviders } from "./validation-providers";

describe("fetchValidationProviders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes raw fetch network TypeError into retryable NetworkError", async () => {
    stubFetchFailure(new TypeError("Failed to fetch"));

    const error = await captureRejection(fetchValidationProviders);

    expect(error).toBeInstanceOf(NetworkError);
    expect(shouldRetryQuery(0, error)).toBe(true);
  });

  it("normalizes HTTP 5xx responses into retryable HttpError", async () => {
    stubFetchResponse(503);

    const error = await captureRejection(fetchValidationProviders);

    expect(error).toBeInstanceOf(HttpError);
    expect(shouldRetryQuery(0, error)).toBe(true);
  });

  it("normalizes HTTP 4xx responses into non-retryable HttpError", async () => {
    stubFetchResponse(404);

    const error = await captureRejection(fetchValidationProviders);

    expect(error).toBeInstanceOf(HttpError);
    expect(shouldRetryQuery(0, error)).toBe(false);
  });
});
