import { beforeEach, describe, expect, it, vi } from "vitest";
import { TwitterErrorCode } from "../error-codes";
import { twitterProvider } from "../plugin";
import { parseTwitterError } from "../utils";

const { getUserByUsernameMock } = vi.hoisted(() => ({
  getUserByUsernameMock: vi.fn(),
}));

vi.mock("../client", () => ({
  getTwitterClient: () => ({
    getUserByUsername: getUserByUsernameMock,
  }),
}));

beforeEach(() => {
  getUserByUsernameMock.mockReset();
});

describe("twitterProvider.rules.user_exists.inputSchema", () => {
  it("accepts usernames matching the advertised Twitter pattern", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse("User_Name1");

    expect(result?.success).toBe(true);
  });

  it("accepts usernames at the minimum and maximum Twitter lengths", () => {
    const schema = twitterProvider.rules.user_exists?.inputSchema;

    expect(schema?.safeParse("a").success).toBe(true);
    expect(schema?.safeParse("a".repeat(15)).success).toBe(true);
  });

  it("rejects empty usernames", () => {
    const result = twitterProvider.rules.user_exists?.inputSchema.safeParse("");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames with characters outside the advertised pattern", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse("user/name");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames longer than fifteen characters", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse(
        "sixteen_chars_123",
      );

    expect(result?.success).toBe(false);
  });
});

describe("twitterProvider.rules.user_exists.validate", () => {
  it("uses Twitter retry-after headers for rate limits", async () => {
    getUserByUsernameMock.mockRejectedValueOnce({
      response: {
        status: 429,
        headers: { "retry-after": "45" },
        data: { title: "Too Many Requests" },
      },
    });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_API_RATE_LIMIT,
      retryAfter: 45,
    });
  });
});

describe("parseTwitterError", () => {
  it("prefers Twitter retry_after body seconds for rate limits", () => {
    expect(
      parseTwitterError({
        response: {
          status: 429,
          headers: { "retry-after": "45" },
          data: { title: "Too Many Requests", retry_after: 30 },
        },
      }),
    ).toMatchObject({
      code: TwitterErrorCode.TWITTER_API_RATE_LIMIT,
      retryAfterSeconds: 30,
    });
  });
});
