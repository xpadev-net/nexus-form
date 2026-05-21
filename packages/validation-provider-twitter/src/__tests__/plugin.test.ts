import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
  TwitterUserInfoSchema: z.object({
    id: z.string().min(1),
    username: z.string().min(1),
    name: z.string().min(1),
    profile_image_url: z.string().url().optional(),
  }),
}));

beforeEach(() => {
  getUserByUsernameMock.mockReset();
  vi.unstubAllGlobals();
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

  it("falls back to sixty seconds when Twitter reports zero retry_after", async () => {
    getUserByUsernameMock.mockRejectedValueOnce({
      response: {
        status: 429,
        data: { title: "Too Many Requests", retry_after: 0 },
      },
    });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_API_RATE_LIMIT,
      retryAfter: 60,
      retryable: true,
    });
  });

  it("marks Twitter 5xx API errors as retryable", async () => {
    getUserByUsernameMock.mockRejectedValueOnce({
      response: {
        status: 503,
        data: { title: "Service unavailable" },
      },
    });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_API_ERROR,
      errorMessage: "Service unavailable",
      retryable: true,
    });
  });

  it.each([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ECONNRESET",
    "EAI_AGAIN",
    "ECONNABORTED",
  ])("marks Twitter %s network errors as retryable", async (code) => {
    getUserByUsernameMock.mockRejectedValueOnce(
      Object.assign(new Error("Temporary network failure"), { code }),
    );

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.NETWORK_ERROR,
      retryable: true,
    });
  });

  it("marks Twitter ETIMEDOUT errors as timeout errors", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" }),
    );

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TIMEOUT,
      retryable: true,
    });
  });

  it("keeps Twitter authentication errors non-retryable", async () => {
    getUserByUsernameMock.mockRejectedValueOnce({
      response: {
        status: 401,
        data: { title: "Unauthorized" },
      },
    });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_AUTH_FAILED,
      retryable: false,
    });
  });

  it("does not mark malformed Twitter user data as valid", async () => {
    getUserByUsernameMock.mockResolvedValueOnce({ id: "123" });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_API_ERROR,
      errorMessage: "Twitter API returned malformed user data",
      retryable: false,
    });
  });

  it("does not mark malformed Twitter profile image URLs as valid", async () => {
    getUserByUsernameMock.mockResolvedValueOnce({
      id: "123",
      username: "username",
      name: "User Name",
      profile_image_url: "not-a-url",
    });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_API_ERROR,
      errorMessage: "Twitter API returned malformed user data",
      retryable: false,
    });
  });
});

describe("twitterProvider.healthCheck", () => {
  it("treats successful responses as a healthy Twitter API check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(true);
  });

  it("uses the Twitter user lookup endpoint and treats auth failures as reachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twitter.com/2/users/by/username/TwitterDev",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("treats rate limits as a reachable Twitter API check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(true);
  });

  it("treats forbidden responses as a reachable Twitter API check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(true);
  });

  it("treats missing probe users as a reachable Twitter API check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(true);
  });

  it("treats server errors as an unhealthy Twitter API check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(false);
  });

  it("treats network errors as an unhealthy Twitter API check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const healthCheck = twitterProvider.healthCheck;

    if (!healthCheck) throw new Error("healthCheck is not defined");

    await expect(healthCheck()).resolves.toBe(false);
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
