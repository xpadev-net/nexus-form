import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  db: {
    delete: vi.fn(),
    insert: vi.fn(),
  },
  deleteWhere: vi.fn(),
  insertValues: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  account: {},
  db: mocks.db,
  session: {},
  user: {},
  verificationToken: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  discordGuild: {
    discordUserId: "discordGuild.discordUserId",
  },
  discordUser: {},
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({})),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
}));

vi.mock("../brand-config", () => ({
  brandConfig: { cookiePrefix: "test" },
}));

vi.mock("../logger", () => ({
  logError: mocks.logError,
  logInfo: mocks.logInfo,
  logWarn: mocks.logWarn,
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

describe("syncDiscordGuilds", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete process.env.DISCORD_BOT_TOKEN;

    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.db.delete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.db.insert.mockReturnValue({ values: mocks.insertValues });
  });

  it("syncs administrator guilds after validating Discord guild responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          {
            id: "guild-1",
            name: "Admins",
            icon: "icon-hash",
            permissions: "8",
          },
          {
            id: "guild-2",
            name: "Members",
            icon: null,
            permissions: "0",
          },
        ]),
      ),
    );
    const { syncDiscordGuilds } = await import("../auth");

    await syncDiscordGuilds("discord-user-1", "access-token");

    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        guildId: "guild-1",
        name: "Admins",
        iconUrl: "https://cdn.discordapp.com/icons/guild-1/icon-hash.webp",
        discordUserId: "discord-user-1",
      }),
    ]);
    expect(mocks.logWarn).not.toHaveBeenCalledWith(
      "Invalid Discord guilds response",
      "integration",
      expect.anything(),
    );
  });

  it("filters administrator guilds by validated bot guild membership", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: "guild-1",
              name: "Admins with bot",
              icon: null,
              permissions: "8",
            },
            {
              id: "guild-2",
              name: "Admins without bot",
              icon: null,
              permissions: "8",
            },
            {
              id: "guild-3",
              name: "Members with bot",
              icon: null,
              permissions: "0",
            },
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: "guild-1" }, { id: "guild-3" }]),
        ),
    );
    const { syncDiscordGuilds } = await import("../auth");

    await syncDiscordGuilds("discord-user-1", "access-token");

    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        guildId: "guild-1",
        name: "Admins with bot",
        discordUserId: "discord-user-1",
      }),
    ]);
  });

  it("fails closed when Discord guild response has malformed permissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          {
            id: "guild-1",
            name: "Admins",
            icon: null,
            permissions: "not-a-number",
          },
        ]),
      ),
    );
    const { syncDiscordGuilds } = await import("../auth");

    await syncDiscordGuilds("discord-user-1", "access-token");

    expect(mocks.db.delete).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "Invalid Discord guilds response",
      "integration",
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("fails closed when Discord guild response is not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: "guild-1", permissions: "8" })),
    );
    const { syncDiscordGuilds } = await import("../auth");

    await syncDiscordGuilds("discord-user-1", "access-token");

    expect(mocks.db.delete).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "Invalid Discord guilds response",
      "integration",
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("fails closed when bot guild response is malformed", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: "guild-1",
              name: "Admins",
              icon: null,
              permissions: "8",
            },
          ]),
        )
        .mockResolvedValueOnce(jsonResponse([{ name: "missing id" }])),
    );
    const { syncDiscordGuilds } = await import("../auth");

    await syncDiscordGuilds("discord-user-1", "access-token");

    expect(mocks.db.delete).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "Invalid Discord bot guilds response",
      "integration",
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("fails closed when bot guild response is an HTTP error", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: "guild-1",
              name: "Admins",
              icon: null,
              permissions: "8",
            },
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse({ error: "rate limited" }, false, 429),
        ),
    );
    const { syncDiscordGuilds } = await import("../auth");

    await syncDiscordGuilds("discord-user-1", "access-token");

    expect(mocks.db.delete).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "Failed to fetch Bot guilds",
      "integration",
      { status: 429 },
    );
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
