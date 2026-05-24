import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCORD_CONFIG_DEFAULTS,
  getDiscordApiTimeoutMs,
  MAX_TIMER_MS,
} from "../config";
import { DiscordErrorCode } from "../error-codes";
import { discordProvider } from "../plugin";
import { discordApiFetch, getGuild } from "../requests";
import { ZDiscordGuildId, ZDiscordToken } from "../types";
import { getRateLimitRetryAfter } from "../utils";

afterEach(() => {
  delete process.env.DISCORD_API_TIMEOUT_MS;
  delete process.env.DISCORD_BOT_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("discordProvider.rules.guild_member.configSchema", () => {
  it("accepts valid Discord snowflake IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "123456789012345678",
      roleIds: ["234567890123456789"],
      roleCondition: "AND",
    });

    expect(result?.success).toBe(true);
  });

  it("rejects empty guild IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "",
    });

    expect(result?.success).toBe(false);
  });

  it("rejects malformed guild IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "not-a-discord-id",
    });

    expect(result?.success).toBe(false);
  });

  it("rejects malformed role IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "123456789012345678",
      roleIds: ["role-name"],
    });

    expect(result?.success).toBe(false);
  });

  it("rejects invalid username lookup modes", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "123456789012345678",
      usernameLookupMode: "scan_everything",
    });

    expect(result?.success).toBe(false);
  });

  it("does not call list members for saturated username searches by default", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    const saturatedSearch = Array.from({ length: 1000 }, (_, index) => ({
      user: {
        id: String(100000000000000000n + BigInt(index)),
        username: `targetuser_${index}`,
      },
      roles: [],
    }));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/guilds/123456789012345678?with_counts=true")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            id: "123456789012345678",
            name: "Test Guild",
            icon: null,
          }),
        });
      }
      if (url.includes("/members/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(saturatedSearch),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({ message: "not found" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discordProvider.rules.guild_member?.validate(
      "targetuser",
      { guildId: "123456789012345678" },
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_USER_NOT_MEMBER,
    });
    expect(
      fetchMock.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).includes("/members?"),
      ),
    ).toHaveLength(0);
  });

  it("calls list members for saturated username searches when legacy scan is enabled", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    const targetId = "999999999999999999";
    const saturatedSearch = Array.from({ length: 1000 }, (_, index) => ({
      user: {
        id: String(100000000000000000n + BigInt(index)),
        username: `targetuser_${index}`,
      },
      roles: [],
    }));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/guilds/123456789012345678?with_counts=true")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            id: "123456789012345678",
            name: "Test Guild",
            icon: null,
          }),
        });
      }
      if (url.includes("/members/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(saturatedSearch),
        });
      }
      if (url.includes("/members?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue([
            {
              user: { id: targetId, username: "targetuser" },
              roles: [],
            },
          ]),
        });
      }
      if (url.includes("/roles")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue([]),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({ message: "not found" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discordProvider.rules.guild_member?.validate(
      "targetuser",
      {
        guildId: "123456789012345678",
        usernameLookupMode: "legacy_scan",
      },
    );

    expect(result).toMatchObject({
      isValid: true,
      metadata: {
        userId: targetId,
        username: "targetuser",
      },
    });
    expect(
      fetchMock.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).includes("/members?"),
      ),
    ).toHaveLength(1);
  });

  it("falls back to thirty seconds when Discord reports zero retry_after", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "rate limited",
            retry_after: 0,
            global: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "rate limited again",
            retry_after: 0,
            global: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "still rate limited",
            retry_after: 0,
            global: false,
          }),
          body: { cancel: vi.fn() },
        }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_RATE_LIMIT,
      retryAfter: 30,
      retryable: true,
    });
  });

  it("marks Discord fetch network failures as retryable", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new TypeError("fetch failed"), { code: "EAI_AGAIN" }),
        ),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_ERROR,
      retryable: true,
    });
  });

  it("marks Discord abort timeout failures as retryable", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    const timeoutError = new Error("The operation timed out");
    timeoutError.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_ERROR,
      retryable: true,
    });
  });

  it("marks Discord 5xx responses as retryable", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: "Server error" }),
      }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_ERROR,
      retryable: true,
    });
  });

  it("keeps unhandled Discord 4xx HTTP errors non-retryable", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "network timeout",
        json: vi.fn().mockResolvedValue({ message: "network timeout" }),
      }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_ERROR,
      retryable: false,
    });
  });

  it("keeps Discord authentication failures non-retryable", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ message: "Unauthorized" }),
      }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_AUTH_FAILED,
    });
    expect(result).not.toHaveProperty("retryable");
  });
});

describe("discordProvider.rules.guild_member.inputSchema", () => {
  it("accepts usernames matching the advertised Discord pattern", () => {
    const result =
      discordProvider.rules.guild_member?.inputSchema.safeParse("user.name_1");

    expect(result?.success).toBe(true);
  });

  it("rejects uppercase usernames to match current Discord username rules", () => {
    const result =
      discordProvider.rules.guild_member?.inputSchema.safeParse("User_Name1");

    expect(result?.success).toBe(false);
    expect(discordProvider.rules.guild_member?.inputPattern).toBe(
      "^[a-z0-9_.]{2,32}$",
    );
    expect(discordProvider.rules.guild_member?.patternTemplate?.pattern).toBe(
      "^[a-z0-9_.]{2,32}$",
    );
  });

  it("accepts usernames at the minimum and maximum Discord lengths", () => {
    const schema = discordProvider.rules.guild_member?.inputSchema;

    expect(schema?.safeParse("ab").success).toBe(true);
    expect(schema?.safeParse("a".repeat(32)).success).toBe(true);
  });

  it("rejects usernames outside the Discord length boundaries", () => {
    const schema = discordProvider.rules.guild_member?.inputSchema;

    expect(schema?.safeParse("a").success).toBe(false);
    expect(schema?.safeParse("a".repeat(33)).success).toBe(false);
  });

  it("rejects usernames containing characters outside the advertised pattern", () => {
    const result =
      discordProvider.rules.guild_member?.inputSchema.safeParse("user/name");

    expect(result?.success).toBe(false);
  });

  it("rejects legacy discriminator usernames before Discord API lookup", () => {
    const result =
      discordProvider.rules.guild_member?.inputSchema.safeParse("user#1234");

    expect(result?.success).toBe(false);
  });
});

describe("Discord API timeout", () => {
  it("uses DISCORD_API_TIMEOUT_MS when it is a positive integer", () => {
    process.env.DISCORD_API_TIMEOUT_MS = "2500";

    expect(getDiscordApiTimeoutMs()).toBe(2500);
  });

  it("falls back to the default timeout for invalid values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DISCORD_API_TIMEOUT_MS = "invalid";

    expect(getDiscordApiTimeoutMs()).toBe(DISCORD_CONFIG_DEFAULTS.API_TIMEOUT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("DISCORD_API_TIMEOUT_MS"),
    );
  });

  it("falls back to the default timeout for values above the timer max", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DISCORD_API_TIMEOUT_MS = String(MAX_TIMER_MS + 1);

    expect(getDiscordApiTimeoutMs()).toBe(DISCORD_CONFIG_DEFAULTS.API_TIMEOUT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("DISCORD_API_TIMEOUT_MS"),
    );
  });

  it("warns and clamps values below the minimum timeout", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DISCORD_API_TIMEOUT_MS = "50";

    expect(getDiscordApiTimeoutMs()).toBe(
      DISCORD_CONFIG_DEFAULTS.MIN_API_TIMEOUT,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("below the minimum"),
    );
  });

  it("passes DISCORD_API_TIMEOUT_MS to Discord API requests", async () => {
    process.env.DISCORD_API_TIMEOUT_MS = "1500";
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: "123456789012345678",
        name: "Test Guild",
        icon: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getGuild(
      ZDiscordToken.parse("bot-token"),
      ZDiscordGuildId.parse("123456789012345678"),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(1500);
  });

  it("composes caller-provided signals with the timeout signal", async () => {
    process.env.DISCORD_API_TIMEOUT_MS = "1500";
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const composedSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, "any").mockReturnValue(composedSignal);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    await discordApiFetch("https://discord.com/api/v10/test", {
      signal: callerSignal,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(1500);
    expect(anySpy).toHaveBeenCalledWith([callerSignal, timeoutSignal]);
    expect(fetchMock).toHaveBeenCalledWith("https://discord.com/api/v10/test", {
      signal: composedSignal,
    });
  });

  it("attaches a fresh timeout signal to each retry attempt", async () => {
    process.env.DISCORD_API_TIMEOUT_MS = "1500";
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({
          message: "rate limited",
          retry_after: 0,
          global: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({
          message: "rate limited again",
          retry_after: 0,
          global: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          id: "123456789012345678",
          name: "Test Guild",
          icon: null,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await getGuild(
      ZDiscordToken.parse("bot-token"),
      ZDiscordGuildId.parse("123456789012345678"),
    );

    const signals = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenCalledWith(1500);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(new Set(signals).size).toBe(3);
  });
});

describe("discordProvider.rules.guild_member.validate error classification", () => {
  it("returns auth failure for Discord 401 responses", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_AUTH_FAILED,
    });
  });

  it("returns Discord retry_after seconds for repeated 429 responses", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "rate limited",
            retry_after: 0,
            global: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "rate limited again",
            retry_after: 0,
            global: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "still rate limited",
            retry_after: 12.2,
            global: false,
          }),
          body: { cancel: vi.fn() },
        }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_RATE_LIMIT,
      retryAfter: 13,
    });
  });

  it("keeps final malformed 429 responses classified as rate limits", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "rate limited",
            retry_after: 0,
            global: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({
            message: "rate limited again",
            retry_after: 0,
            global: false,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: vi.fn().mockRejectedValue(new SyntaxError("Invalid JSON")),
          body: { cancel: vi.fn() },
        }),
    );

    const result = await discordProvider.rules.guild_member?.validate("user", {
      guildId: "123456789012345678",
    });

    expect(result).toMatchObject({
      isValid: false,
      errorCode: DiscordErrorCode.DISCORD_API_RATE_LIMIT,
      retryAfter: 30,
    });
  });
});

describe("Discord rate limit helpers", () => {
  it("returns retry-after values in seconds", () => {
    expect(getRateLimitRetryAfter({ retry_after: 2.5 })).toBe(2.5);
    expect(getRateLimitRetryAfter({ headers: { "retry-after": "7" } })).toBe(7);
  });
});
