import type { BetterAuthOptions } from "better-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

type AuthHookInput = {
  path: string;
  body: unknown;
  headers: Headers;
  context: {
    internalAdapter: {
      findVerificationValue: (
        identifier: string,
      ) => Promise<{ expiresAt: Date } | null>;
    };
  };
};

type AuthDatabaseHookContext = {
  path: string;
  body?: unknown;
  params?: unknown;
  getCookie: (name: string) => string | null;
  context: {
    internalAdapter: {
      consumeVerificationValue: (identifier: string) => Promise<unknown | null>;
    };
  };
};

type AuthOptionsUnderTest = Omit<
  BetterAuthOptions,
  "hooks" | "databaseHooks"
> & {
  hooks?: {
    before?: (input: AuthHookInput) => Promise<unknown>;
  };
  databaseHooks?: {
    user?: {
      create?: {
        before?: (
          user: unknown,
          context: AuthDatabaseHookContext | null,
        ) => Promise<unknown>;
      };
    };
    session?: unknown;
  };
};

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  createVerificationValue: vi.fn(async (data: unknown) => data),
  options: undefined as AuthOptionsUnderTest | undefined,
}));

vi.mock("@nexus-form/database", () => ({
  account: {},
  db: {},
  session: {},
  user: {},
  verificationToken: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  discordGuild: {},
  discordUser: {},
}));

vi.mock("better-auth", () => ({
  betterAuth: mocks.betterAuth,
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("../lib/brand-config", () => ({
  brandConfig: { cookiePrefix: "test" },
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const getAuthOptions = (): AuthOptionsUnderTest => {
  if (!mocks.options) throw new Error("Better Auth was not initialized");
  return mocks.options;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_CLIENT_ID", "discord-client-id");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "discord-client-secret");
  vi.stubEnv("AUTH_SECRET", "test-auth-secret");
  mocks.options = undefined;
  mocks.betterAuth.mockImplementation((options: AuthOptionsUnderTest) => {
    mocks.options = options;
    return {
      $context: Promise.resolve({
        internalAdapter: {
          createVerificationValue: mocks.createVerificationValue,
        },
      }),
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("invitation-gated Discord registration", () => {
  it("disables implicit Discord signup and installs the admission hook", async () => {
    await import("../lib/auth");

    const options = getAuthOptions();
    expect(options.socialProviders).toMatchObject({
      discord: { disableImplicitSignUp: true },
    });
    expect(options.hooks?.before).toEqual(expect.any(Function));
  });

  it("overrides an attacker-supplied signup request without authorization", async () => {
    const { authorizeDiscordSignupRequest } = await import("../lib/auth");
    const findInvitation = vi.fn(async () => ({
      expiresAt: new Date(Date.now() + 60_000),
    }));

    const decision = await authorizeDiscordSignupRequest({
      path: "/sign-in/social",
      body: {
        provider: "discord",
        callbackURL: "http://localhost:3000/",
        requestSignUp: true,
      },
      invitationToken: null,
      findInvitation,
    });

    expect(decision.body).toEqual({
      provider: "discord",
      callbackURL: "http://localhost:3000/",
      requestSignUp: false,
    });
    expect(decision.apply).toBe(true);
    expect(findInvitation).not.toHaveBeenCalled();
  });

  it.each([
    "malformed",
    "a".repeat(192),
  ])("fails closed for invalid invitation token %s", async (invitationToken) => {
    const { authorizeDiscordSignupRequest } = await import("../lib/auth");
    const findInvitation = vi.fn(async () => ({
      expiresAt: new Date(Date.now() + 60_000),
    }));

    const decision = await authorizeDiscordSignupRequest({
      path: "/sign-in/social",
      body: { provider: "discord", requestSignUp: true },
      invitationToken,
      findInvitation,
    });

    expect(decision.body).toMatchObject({ requestSignUp: false });
    expect(decision.apply).toBe(true);
    expect(findInvitation).not.toHaveBeenCalled();
  });

  it("marks signup intent for an unexpired invitation authorization", async () => {
    const { authorizeDiscordSignupRequest } = await import("../lib/auth");
    const invitationToken = "a".repeat(64);
    const findInvitation = vi.fn(async () => ({
      expiresAt: new Date(Date.now() + 60_000),
    }));

    const request = {
      path: "/sign-in/social",
      body: { provider: "discord" },
      invitationToken,
      findInvitation,
    };
    const decision = await authorizeDiscordSignupRequest(request);

    expect(decision.body).toMatchObject({ requestSignUp: true });
    expect(findInvitation).toHaveBeenCalledWith(
      `signup-invitation:${invitationToken}`,
    );
    expect(decision.apply).toBe(true);
  });

  it("fails closed for an expired authorization", async () => {
    const { authorizeDiscordSignupRequest } = await import("../lib/auth");
    const invitationToken = "b".repeat(64);
    const findInvitation = vi.fn(async () => ({
      expiresAt: new Date(Date.now() - 1),
    }));

    const decision = await authorizeDiscordSignupRequest({
      path: "/sign-in/social",
      body: { provider: "discord" },
      invitationToken,
      findInvitation,
    });

    expect(decision.body).toEqual({
      provider: "discord",
      requestSignUp: false,
    });
    expect(findInvitation).toHaveBeenCalledWith(
      `signup-invitation:${invitationToken}`,
    );
  });

  it("fails closed for an unknown authorization", async () => {
    const { authorizeDiscordSignupRequest } = await import("../lib/auth");
    const invitationToken = "c".repeat(64);
    const findInvitation = vi.fn(async () => null);

    const decision = await authorizeDiscordSignupRequest({
      path: "/sign-in/social",
      body: { provider: "discord" },
      invitationToken,
      findInvitation,
    });

    expect(decision.body).toMatchObject({ requestSignUp: false });
  });

  it("does not consume an invitation for unrelated auth requests", async () => {
    const { authorizeDiscordSignupRequest } = await import("../lib/auth");
    const body = { provider: "github", requestSignUp: true };
    const findInvitation = vi.fn(async () => ({
      expiresAt: new Date(Date.now() + 60_000),
    }));

    const decision = await authorizeDiscordSignupRequest({
      path: "/sign-in/social",
      body,
      invitationToken: "a".repeat(64),
      findInvitation,
    });

    expect(decision.body).toBe(body);
    expect(decision.apply).toBe(false);
    expect(findInvitation).not.toHaveBeenCalled();
  });

  it("returns the guarded body from the installed Better Auth hook", async () => {
    await import("../lib/auth");
    const beforeHook = getAuthOptions().hooks?.before;
    if (!beforeHook) throw new Error("Expected Better Auth before hook");
    const findVerificationValue = vi.fn(async () => null);
    const hookInput = {
      path: "/sign-in/social",
      body: { provider: "discord", requestSignUp: true },
      headers: new Headers(),
      context: {
        internalAdapter: { findVerificationValue },
      },
    };

    const result = await beforeHook(hookInput);

    expect(result).toEqual({
      context: {
        body: { provider: "discord", requestSignUp: false },
      },
    });
    expect(findVerificationValue).not.toHaveBeenCalled();
  });

  it("atomically admits only one concurrent Discord user creation", async () => {
    await import("../lib/auth");
    const userCreateHook = getAuthOptions().databaseHooks?.user?.create?.before;
    if (!userCreateHook) throw new Error("Expected user create hook");
    const invitationToken = "d".repeat(64);
    let available = true;
    const consumeVerificationValue = vi.fn(async () => {
      if (!available) return null;
      available = false;
      return { id: "authorization" };
    });
    const createContext = (): AuthDatabaseHookContext => ({
      path: "/callback/:id",
      params: { id: "discord" },
      getCookie: () => invitationToken,
      context: { internalAdapter: { consumeVerificationValue } },
    });

    const results = await Promise.allSettled([
      userCreateHook({}, createContext()),
      userCreateHook({}, createContext()),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(consumeVerificationValue).toHaveBeenCalledTimes(2);
    expect(consumeVerificationValue).toHaveBeenCalledWith(
      `signup-invitation:${invitationToken}`,
    );
  });

  it("persists a five-minute single-use authorization", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"));
    const { issueInvitationSignupAuthorization } = await import("../lib/auth");

    const token = await issueInvitationSignupAuthorization();

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.createVerificationValue).toHaveBeenCalledWith({
      identifier: `signup-invitation:${token}`,
      value: "authorized",
      expiresAt: new Date("2026-07-10T00:05:00.000Z"),
    });
  });
});
