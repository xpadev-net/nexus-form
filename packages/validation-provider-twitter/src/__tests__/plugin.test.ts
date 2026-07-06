import { beforeEach, describe, expect, it, vi } from "vitest";
import { TwitterErrorCode } from "../error-codes";
import { twitterProvider } from "../plugin";
import { parseTwitterError } from "../utils";

const { getUserByUsernameMock } = vi.hoisted(() => ({
  getUserByUsernameMock: vi.fn(),
}));

vi.mock("../client", async (importActual) => {
  const actual = await importActual<typeof import("../client")>();
  return {
    ...actual,
    getTwitterClient: () => ({
      getUserByUsername: getUserByUsernameMock,
    }),
  };
});

beforeEach(() => {
  getUserByUsernameMock.mockReset();
  vi.unstubAllGlobals();
});

const validTwitterUser = {
  id: "123",
  username: "TwitterDev",
  name: "Twitter Dev",
  description: "Twitter API account",
  profile_image_url: "http://pbs.twimg.com/profile_images/twitter-dev.png",
  verified: true,
  public_metrics: {
    followers_count: 100,
    following_count: 10,
    tweet_count: 25,
  },
  created_at: "2024-01-01T00:00:00.000Z",
};

describe("twitterProvider.rules.user_exists.inputSchema", () => {
  it("documents bearer token and API permission requirements through provider metadata", () => {
    const rule = twitterProvider.rules.user_exists;

    expect(rule?.description).toContain("TWITTER_BEARER_TOKEN");
    expect(rule?.inputHint).toContain("Users lookup権限");
  });

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

  it("rejects a single underscore username", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse("_");

    expect(result?.success).toBe(false);
  });

  it("does not call the Twitter client for a single underscore username", async () => {
    const result = await twitterProvider.rules.user_exists?.validate("_", {});

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.INVALID_INPUT,
      retryable: false,
    });
    expect(getUserByUsernameMock).not.toHaveBeenCalled();
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
  it("returns safe metadata for an existing Twitter user", async () => {
    getUserByUsernameMock.mockResolvedValueOnce(validTwitterUser);

    const result = await twitterProvider.rules.user_exists?.validate(
      "TwitterDev",
      {},
    );

    expect(result).toEqual({
      isValid: true,
      metadata: {
        username: "TwitterDev",
        userId: "123",
        displayName: "Twitter Dev",
        avatarUrl: "https://pbs.twimg.com/profile_images/twitter-dev.png",
        verified: true,
        profileUrl: "https://twitter.com/TwitterDev",
        bio: "Twitter API account",
        followersCount: 100,
        followingCount: 10,
        tweetCount: 25,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      outputValues: [
        {
          key: "username",
          label: "Twitter/X username",
          value: "TwitterDev",
        },
        {
          key: "display_name",
          label: "Display name",
          value: "Twitter Dev",
        },
        {
          key: "profile_url",
          label: "Profile URL",
          value: "https://twitter.com/TwitterDev",
        },
        { key: "followers", label: "Followers", value: 100 },
        { key: "verified", label: "Verified", value: true },
      ],
    });
  });

  it("returns a non-retryable failure when the Twitter user is missing", async () => {
    getUserByUsernameMock.mockResolvedValueOnce(null);

    const result = await twitterProvider.rules.user_exists?.validate(
      "missing_user",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_USER_NOT_FOUND,
      errorMessage: "Twitterユーザーが見つかりません",
    });
    expect(result).not.toHaveProperty("retryable", true);
  });

  it("classifies invalid usernames as input validation errors", async () => {
    const result = await twitterProvider.rules.user_exists?.validate(
      "user/name",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.INVALID_INPUT,
      retryable: false,
    });
    expect(getUserByUsernameMock).not.toHaveBeenCalled();
  });

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

  it("marks Twitter 5xx API errors as retryable without leaking upstream details", async () => {
    getUserByUsernameMock.mockRejectedValueOnce({
      response: {
        status: 503,
        data: {
          detail:
            "upstream timeout https://api.twitter.com/2/users token=secret trace=abc123",
          title: "Service unavailable",
        },
      },
    });

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TWITTER_API_ERROR,
      errorMessage: "Twitter API is temporarily unavailable",
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
      Object.assign(
        new Error(
          "connect ETIMEDOUT https://api.twitter.com/2/users token=secret",
        ),
        { code: "ETIMEDOUT" },
      ),
    );

    const result = await twitterProvider.rules.user_exists?.validate(
      "username",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: TwitterErrorCode.TIMEOUT,
      errorMessage: "Request to Twitter API timed out",
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
