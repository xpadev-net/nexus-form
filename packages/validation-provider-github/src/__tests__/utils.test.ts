import { describe, expect, it, vi } from "vitest";
import { GitHubErrorCode } from "../error-codes";
import {
  GitHubProviderError,
  getGitHubErrorCode,
  getGitHubRateLimitRetryAfter,
  isGitHubProviderError,
  isGitHubRateLimitError,
  parseGitHubError,
} from "../utils";

describe("GitHub error utilities", () => {
  it("detects rate limit errors without casting Octokit responses", () => {
    const error = {
      status: 403,
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
        },
      },
    };

    expect(isGitHubRateLimitError(error)).toBe(true);
    expect(getGitHubErrorCode(error)).toBe(
      GitHubErrorCode.GITHUB_API_RATE_LIMIT,
    );
  });

  it("reads retry-after milliseconds from reset headers", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-19T00:00:00.000Z"));
      const resetSeconds = Math.floor(Date.now() / 1000) + 90;
      const error = {
        status: 403,
        response: {
          headers: {
            "X-RateLimit-Reset": String(resetSeconds),
          },
        },
      };

      expect(getGitHubRateLimitRetryAfter(error)).toBe(90_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses nested GitHub response messages and validation errors", () => {
    expect(
      parseGitHubError({
        response: {
          data: {
            message: "Primary response message",
          },
        },
      }),
    ).toBe("Primary response message");

    expect(
      parseGitHubError({
        response: {
          data: {
            errors: [{ message: "first" }, { message: "second" }, {}],
          },
        },
      }),
    ).toBe("first; second");
  });

  it("classifies network-shaped errors without unchecked casts", () => {
    expect(getGitHubErrorCode({ code: "ENOTFOUND" })).toBe(
      GitHubErrorCode.NETWORK_ERROR,
    );
    expect(getGitHubErrorCode({ errno: "ETIMEDOUT" })).toBe(
      GitHubErrorCode.TIMEOUT,
    );
  });

  it.each([
    "ECONNRESET",
    "EAI_AGAIN",
    "ECONNABORTED",
  ])("classifies %s as a retryable network error", (code) => {
    expect(getGitHubErrorCode({ code })).toBe(GitHubErrorCode.NETWORK_ERROR);
  });

  it("narrows enhanced provider errors", () => {
    const error = new GitHubProviderError(
      "rate limited",
      GitHubErrorCode.GITHUB_API_RATE_LIMIT,
      30_000,
    );

    expect(isGitHubProviderError(error)).toBe(true);
    expect(error.code).toBe(GitHubErrorCode.GITHUB_API_RATE_LIMIT);
    expect(error.retryAfter).toBe(30_000);
  });
});
