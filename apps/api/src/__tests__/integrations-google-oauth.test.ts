import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })),
    insert: vi.fn(() => ({
      values: mocks.insertValues.mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  formPermission: {},
  googleOAuthToken: {
    id: "googleOAuthToken.id",
    userId: "googleOAuthToken.userId",
  },
}));

vi.mock("../lib/crypto/field-encryption", () => ({
  decryptFromBase64: (value: string) => value,
  encryptToBase64: (value: string) => value,
}));

vi.mock("../lib/dual-auth", () => ({
  withDualAuth:
    () =>
    async (
      c: {
        set: (
          key: string,
          value: { auth_type: "session"; user_id: string },
        ) => void;
      },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "user-1",
      });
      await next();
    },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

const { createHonoApp } = await import("../lib/hono");
const { integrationsGoogleRouter, resetTrustedAppOriginsForTesting } =
  await import("../routes/integrations-google");

function createApp() {
  return createHonoApp().route(
    "/api/integrations/google",
    integrationsGoogleRouter,
  );
}

describe("Google OAuth redirect URI", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    resetTrustedAppOriginsForTesting();
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("TRUSTED_ORIGINS", "https://app.example.com");
  });

  it("fails authorization when the fixed OAuth base URL is not configured", async () => {
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/authorize?app_origin=https%3A%2F%2Fapp.example.com",
      {
        headers: {
          origin: "https://evil.example",
        },
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Google OAuth is not configured",
    });
  });

  it("fails authorization when the fixed OAuth base URL is not HTTP(S)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "ftp://api.example.com");
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/authorize?app_origin=https%3A%2F%2Fapp.example.com",
      {
        headers: {
          origin: "https://evil.example",
        },
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Google OAuth is not configured",
    });
  });

  it("uses the configured OAuth base URL for authorization redirects", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://api.example.com");
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/authorize?app_origin=https%3A%2F%2Fapp.example.com&state=abcdefghijklmnopqrstuvwxyzABCDEF",
      {
        headers: {
          origin: "https://evil.example",
        },
      },
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const redirectLocation = new URL(location ?? "");
    expect(redirectLocation.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/api/integrations/google/callback",
    );
  });

  it("uses the configured OAuth base URL when exchanging callback codes", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://api.example.com");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/spreadsheets",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    const response = await app.request(
      "/api/integrations/google/callback?code=oauth-code&state=state-123",
      {
        headers: {
          cookie:
            "google_oauth_state=state-123; google_oauth_app_origin=https%3A%2F%2Fapp.example.com",
          origin: "https://evil.example",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toBeDefined();
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init?.body as URLSearchParams).get("redirect_uri")).toBe(
      "https://api.example.com/api/integrations/google/callback",
    );
  });
});
