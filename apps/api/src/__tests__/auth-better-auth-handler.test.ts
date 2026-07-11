import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../load-env", () => ({}));

const memoryDb = vi.hoisted(() => {
  const records = (): Record<string, unknown>[] => [];
  return {
    account: records(),
    session: records(),
    user: records(),
    verification: records(),
  };
});

const projectDbMocks = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return {
    db: { select: vi.fn(() => ({ from })) },
    from,
    limit,
    where,
  };
});

vi.mock("@nexus-form/database", () => ({
  account: {},
  db: projectDbMocks.db,
  session: {},
  user: {},
  verificationToken: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  discordGuild: {},
  discordUser: {},
}));

vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await vi.importActual<
    typeof import("better-auth/adapters/memory")
  >("better-auth/adapters/memory");
  return {
    drizzleAdapter: vi.fn(() => memoryAdapter(memoryDb)),
  };
});

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

const socialSignInResponseSchema = z.object({
  redirect: z.boolean(),
  url: z.string().url(),
});

const getInputUrl = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
};

const getRecordString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | null => {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
};

const discordProfileForCode = (code: string): Record<string, unknown> => {
  if (code === "existing") {
    const id = getRecordString(memoryDb.account[0], "accountId");
    const email = getRecordString(memoryDb.user[0], "email");
    if (!id || !email) throw new Error("Expected an existing OAuth account");
    return {
      id,
      email,
      username: "existing-user",
      global_name: "Existing User",
      verified: true,
      avatar: null,
      discriminator: "0",
    };
  }

  const profiles: Record<string, { id: string; email: string }> = {
    first: { id: "100000000000000001", email: "first@example.com" },
    second: { id: "100000000000000002", email: "second@example.com" },
    unknown: { id: "100000000000000003", email: "unknown@example.com" },
    expired: { id: "100000000000000004", email: "expired@example.com" },
  };
  const profile = profiles[code];
  if (!profile) throw new Error(`Unexpected Discord code: ${code}`);
  return {
    ...profile,
    username: `${code}-user`,
    global_name: `${code} User`,
    verified: true,
    avatar: null,
    discriminator: "0",
  };
};

const createDiscordFetchMock = () =>
  vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = getInputUrl(input);
      if (url === "https://discord.com/api/oauth2/token") {
        if (!(init?.body instanceof URLSearchParams)) {
          throw new Error("Expected Discord token form body");
        }
        const code = init.body.get("code");
        if (!code) throw new Error("Expected Discord authorization code");
        return Response.json({
          access_token: `access-${code}`,
          refresh_token: `refresh-${code}`,
          token_type: "Bearer",
          expires_in: 3_600,
          scope: "identify email",
        });
      }

      if (
        url === "https://discord.com/api/users/@me" ||
        url === "https://discord.com/api/users/%40me"
      ) {
        const requestHeaders = new Headers(init?.headers);
        const authorization = requestHeaders.get("authorization");
        const code = authorization?.replace(/^Bearer access-/, "");
        if (!code) throw new Error("Expected Discord access token");
        return Response.json(discordProfileForCode(code));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  );

type AuthHandler = (request: Request) => Promise<Response>;

const extractCookie = (response: Response, name: string): string => {
  const setCookie = response.headers.get("set-cookie");
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = setCookie?.match(new RegExp(`${escapedName}=([^;,]+)`))?.[1];
  if (!value) throw new Error(`Expected ${name} cookie in ${setCookie}`);
  return `${name}=${value}`;
};

const startDiscordSignIn = async (
  handler: AuthHandler,
  invitationToken?: string,
): Promise<{ state: string; stateCookie: string }> => {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
  });
  if (invitationToken) {
    headers.set("Cookie", `invitation-token=${invitationToken}`);
  }
  const response = await handler(
    new Request("http://localhost:3001/api/auth/sign-in/social", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "discord",
        callbackURL: "http://localhost:3000/",
        requestSignUp: true,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = socialSignInResponseSchema.parse(await response.json());
  const state = new URL(body.url).searchParams.get("state");
  if (!state) throw new Error("Expected OAuth state");
  return { state, stateCookie: extractCookie(response, "test.state") };
};

const completeDiscordSignIn = async (
  handler: AuthHandler,
  flow: { state: string; stateCookie: string },
  code: string,
  invitationToken?: string,
): Promise<Response> => {
  const cookie = invitationToken
    ? `${flow.stateCookie}; invitation-token=${invitationToken}`
    : flow.stateCookie;
  return handler(
    new Request(
      `http://localhost:3001/api/auth/callback/discord?code=${code}&state=${flow.state}`,
      { headers: { Cookie: cookie } },
    ),
  );
};

const runProductionAuthOriginProbe = (input: {
  baseUrl: string;
  betterAuthTrustedOrigins?: string;
}): void => {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    TEST: "false",
    BETTER_AUTH_SECRET: "test-auth-secret-test-auth-secret",
    BETTER_AUTH_URL: input.baseUrl,
    DATABASE_URL: "mysql://user:pass@localhost:3306/db",
    TRUSTED_ORIGINS: "https://app.example.com",
  };
  delete childEnvironment.BETTER_AUTH_TRUSTED_ORIGINS;
  if (input.betterAuthTrustedOrigins) {
    childEnvironment.BETTER_AUTH_TRUSTED_ORIGINS =
      input.betterAuthTrustedOrigins;
  }

  const requestUrl = `${input.baseUrl}/api/auth/sign-out`;
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
        const { auth } = await import('./src/lib/auth.ts');
        const response = await auth.handler(
          new Request(${JSON.stringify(requestUrl)}, {
            method: 'POST',
            headers: {
              Cookie: 'test.session_token=value',
              Origin: 'https://evil.example.com',
            },
          }),
        );
        if (response.status !== 403) {
          throw new Error('Expected 403, received ' + response.status);
        }
      `,
    ],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: "pipe",
    },
  );
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const records of Object.values(memoryDb)) records.splice(0);
  vi.stubEnv("DISCORD_CLIENT_ID", "discord-client-id");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "discord-client-secret");
  vi.stubEnv("AUTH_SECRET", "test-auth-secret");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
  vi.stubEnv("TRUSTED_ORIGINS", "http://localhost:3000");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"));
  vi.stubGlobal("fetch", createDiscordFetchMock());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Better Auth invitation admission handler", () => {
  it("uses the normalized shared origin contract", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "TRUSTED_ORIGINS",
      " HTTPS://APP.EXAMPLE.COM:443/,https://app.example.com ",
    );

    const { auth } = await import("../lib/auth");

    expect(auth.options.trustedOrigins).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
    ]);
  });

  it("keeps localhost as the test default", async () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.TRUSTED_ORIGINS;

    const { auth } = await import("../lib/auth");

    expect(auth.options.trustedOrigins).toEqual(["http://localhost:3000"]);
  });

  it.each([
    [undefined, "missing"],
    ["", "empty"],
    ["not-an-origin", "malformed"],
    ["https://*.example.com", "wildcard"],
    ["https://app.example.com,not-an-origin", "mixed valid and invalid"],
  ])("rejects %s production TRUSTED_ORIGINS during direct auth construction (%s)", async (trustedOrigins, _description) => {
    vi.stubEnv("NODE_ENV", "production");
    if (trustedOrigins === undefined) {
      delete process.env.TRUSTED_ORIGINS;
    } else {
      vi.stubEnv("TRUSTED_ORIGINS", trustedOrigins);
    }

    await expect(import("../lib/auth")).rejects.toThrow(
      "TRUSTED_ORIGINS must contain one or more valid HTTP(S) origins in production",
    );
  });

  it("rejects an untrusted cookie origin at the Better Auth boundary", async () => {
    expect(() =>
      runProductionAuthOriginProbe({ baseUrl: "http://localhost:3001" }),
    ).not.toThrow();
    expect(() =>
      runProductionAuthOriginProbe({
        baseUrl: "http://localhost:3001",
        betterAuthTrustedOrigins: "https://evil.example.com",
      }),
    ).not.toThrow();
    expect(() =>
      runProductionAuthOriginProbe({ baseUrl: "https://evil.example.com" }),
    ).not.toThrow();
  });

  it("fails closed for missing and malformed auth origins with cookie requests", async () => {
    const { auth } = await import("../lib/auth");
    const request = (headers: Record<string, string>, method = "POST") =>
      auth.handler(
        new Request("http://localhost:3001/api/auth/sign-out", {
          method,
          headers,
        }),
      );

    const missingOriginResponse = await request({
      Cookie: "test.session_token=value",
    });
    expect(missingOriginResponse.status).toBe(403);
    await expect(missingOriginResponse.json()).resolves.toMatchObject({
      message: "Invalid origin",
    });

    const emptyCookieResponse = await request({ Cookie: "" });
    expect(emptyCookieResponse.status).not.toBe(403);

    const whitespaceCookieResponse = await request({ Cookie: "   " });
    expect(whitespaceCookieResponse.status).not.toBe(403);

    const malformedOriginResponse = await request({
      Cookie: "test.session_token=value",
      Origin: "not-an-origin",
      Referer: "http://localhost:3000/forms/123",
    });
    expect(malformedOriginResponse.status).toBe(403);

    const refererFallbackResponse = await request({
      Cookie: "test.session_token=value",
      Referer: "http://localhost:3000/forms/123",
    });
    expect(refererFallbackResponse.status).toBe(200);

    const noCookieResponse = await request({
      Origin: "https://evil.example.com",
    });
    expect(noCookieResponse.status).toBe(200);
  });

  it("does not apply the cookie origin guard to safe methods or preflight/callback GETs", async () => {
    const { auth } = await import("../lib/auth");
    const getSessionResponse = await auth.handler(
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: {
          Cookie: "test.session_token=value",
          Origin: "https://evil.example.com",
        },
      }),
    );
    expect(getSessionResponse.status).not.toBe(403);

    const preflightResponse = await auth.handler(
      new Request("http://localhost:3001/api/auth/sign-out", {
        method: "OPTIONS",
        headers: {
          Cookie: "test.session_token=value",
          Origin: "https://evil.example.com",
        },
      }),
    );
    expect(preflightResponse.status).not.toBe(403);

    const callbackResponse = await auth.handler(
      new Request("http://localhost:3001/api/auth/callback/discord?code=code", {
        headers: {
          Cookie: "test.session_token=value",
          Origin: "https://evil.example.com",
        },
      }),
    );
    expect(callbackResponse.status).not.toBe(403);
  });

  it("gates direct, concurrent, existing-user, and expired OAuth callbacks", async () => {
    const { auth, issueInvitationSignupAuthorization } = await import(
      "../lib/auth"
    );

    const invitationToken = await issueInvitationSignupAuthorization();
    const [firstFlow, secondFlow] = await Promise.all([
      startDiscordSignIn(auth.handler, invitationToken),
      startDiscordSignIn(auth.handler, invitationToken),
    ]);
    const concurrentCallbacks = await Promise.all([
      completeDiscordSignIn(auth.handler, firstFlow, "first", invitationToken),
      completeDiscordSignIn(
        auth.handler,
        secondFlow,
        "second",
        invitationToken,
      ),
    ]);

    expect(memoryDb.user).toHaveLength(1);
    expect(memoryDb.account).toHaveLength(1);
    const concurrentLocations = concurrentCallbacks.map((response) =>
      response.headers.get("location"),
    );
    expect(
      concurrentLocations.filter(
        (location) => location === "http://localhost:3000/",
      ),
    ).toHaveLength(1);
    expect(
      concurrentLocations.filter((location) =>
        location?.includes("error=signup_disabled"),
      ),
    ).toHaveLength(1);

    const existingFlow = await startDiscordSignIn(auth.handler);
    const existingResponse = await completeDiscordSignIn(
      auth.handler,
      existingFlow,
      "existing",
    );
    expect(existingResponse.headers.get("location")).toBe(
      "http://localhost:3000/",
    );
    expect(memoryDb.user).toHaveLength(1);

    const unknownFlow = await startDiscordSignIn(auth.handler);
    const unknownResponse = await completeDiscordSignIn(
      auth.handler,
      unknownFlow,
      "unknown",
    );
    expect(unknownResponse.headers.get("location")).toContain(
      "error=signup_disabled",
    );
    expect(memoryDb.user).toHaveLength(1);

    const expiringInvitation = await issueInvitationSignupAuthorization();
    const expiringFlow = await startDiscordSignIn(
      auth.handler,
      expiringInvitation,
    );
    vi.setSystemTime(new Date("2026-07-10T00:05:01.000Z"));
    const expiredResponse = await completeDiscordSignIn(
      auth.handler,
      expiringFlow,
      "expired",
      expiringInvitation,
    );
    expect(expiredResponse.headers.get("location")).toContain(
      "error=signup_disabled",
    );
    expect(memoryDb.user).toHaveLength(1);
  });
});
