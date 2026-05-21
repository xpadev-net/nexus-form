import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const logError = vi.fn();
const providerGet = vi.fn();
const validateApiToken = vi.fn();

vi.mock("../load-env", () => ({}));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession,
    },
  },
}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: providerGet,
  },
}));

vi.mock("../lib/logger", () => ({
  logError,
}));

class MockSuspendedTokenOwnerError extends Error {
  static readonly MESSAGE = "Your account has been suspended";
}

class MockNonAdminTokenOwnerError extends Error {
  static readonly MESSAGE = "Admin scope requires an active admin owner";
}

vi.mock("../lib/tokens", () => ({
  NonAdminTokenOwnerError: MockNonAdminTokenOwnerError,
  SuspendedTokenOwnerError: MockSuspendedTokenOwnerError,
  validateApiToken,
  validateApiTokenForForm: vi.fn(),
  validateApiTokenWithScopes: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  account: {
    userId: "account.userId",
    providerId: "account.providerId",
    accountId: "account.accountId",
    accessToken: "account.accessToken",
  },
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  form: {
    id: "form.id",
    creatorId: "form.creatorId",
  },
  formPermission: {
    formId: "formPermission.formId",
    userId: "formPermission.userId",
    role: "formPermission.role",
  },
  formShareLink: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

const { db } = await import("@nexus-form/database");
const { eq } = await import("drizzle-orm");

const FORM_ID = "form-id";
const OWNER_ID = "owner-user-id";
const EDITOR_ID = "editor-user-id";
const CO_OWNER_ID = "co-owner-user-id";

function mockDbSelectResults(resultSets: unknown[][]): void {
  let callIndex = 0;
  vi.mocked(db.select).mockImplementation(
    () =>
      ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              const result = resultSets[callIndex] ?? [];
              callIndex += 1;
              return Promise.resolve(result);
            }),
          }),
        }),
      }) as unknown as ReturnType<typeof db.select>,
  );
}

function mockSession(userId: string): void {
  getSession.mockResolvedValueOnce({
    user: {
      id: userId,
      isSuspended: false,
    },
    session: {
      id: `session-${userId}`,
    },
  });
}

describe("external service form OAuth authorization", () => {
  let guildsHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    guildsHandler = vi.fn(async (context) => {
      const linkedAccount = await context.getLinkedAccount("discord");
      return {
        accountId: linkedAccount?.accountId ?? null,
      };
    });
    providerGet.mockReturnValue({
      apiHandlers: {
        guilds: guildsHandler,
      },
    });
  });

  it("rejects form editors before they can use the owner's linked account", async () => {
    mockSession(EDITOR_ID);
    mockDbSelectResults([[{ id: FORM_ID, creatorId: OWNER_ID }]]);

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "INSUFFICIENT_PERMISSIONS",
      },
    });
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects non-creator users before using the creator's linked account", async () => {
    mockSession(CO_OWNER_ID);
    mockDbSelectResults([[{ id: FORM_ID, creatorId: OWNER_ID }]]);

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "INSUFFICIENT_PERMISSIONS",
      },
    });
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects non-creator API token owners before using the creator's linked account", async () => {
    validateApiToken.mockResolvedValueOnce({
      user_id: CO_OWNER_ID,
      token_id: "token-id",
      scopes: ["read"],
      form_ids: [FORM_ID],
    });
    mockDbSelectResults([[{ id: FORM_ID, creatorId: OWNER_ID }]]);

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
      {
        headers: {
          authorization: "Bearer token-value",
        },
      },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "INSUFFICIENT_PERMISSIONS",
      },
    });
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects API token calls without an explicit form context", async () => {
    validateApiToken.mockResolvedValueOnce({
      user_id: OWNER_ID,
      token_id: "token-id",
      scopes: ["read"],
      form_ids: [FORM_ID],
    });

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request("/discord/guilds", {
      headers: {
        authorization: "Bearer token-value",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "API_TOKEN_FORM_CONTEXT_REQUIRED",
      },
    });
    expect(providerGet).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects share-link API token principals before using linked accounts", async () => {
    validateApiToken.mockResolvedValueOnce({
      user_id: "share-link:link-id",
      token_id: "token-id",
      scopes: ["read"],
      form_ids: [FORM_ID],
      share_link_id: "link-id",
    });

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
      {
        headers: {
          authorization: "Bearer token-value",
        },
      },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "SYNTHETIC_PRINCIPAL_NOT_ALLOWED",
      },
    });
    expect(providerGet).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects share-link API token principals with the synthetic-principal code when formId is missing", async () => {
    validateApiToken.mockResolvedValueOnce({
      user_id: "share-link:link-id",
      token_id: "token-id",
      scopes: ["read"],
      form_ids: [FORM_ID],
      share_link_id: "link-id",
    });

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request("/discord/guilds", {
      headers: {
        authorization: "Bearer token-value",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "SYNTHETIC_PRINCIPAL_NOT_ALLOWED",
      },
    });
    expect(providerGet).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects anonymous API token principals before using linked accounts", async () => {
    validateApiToken.mockResolvedValueOnce({
      user_id: "anon:token-id",
      token_id: "token-id",
      scopes: ["read"],
      form_ids: [FORM_ID],
    });

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
      {
        headers: {
          authorization: "Bearer token-value",
        },
      },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "SYNTHETIC_PRINCIPAL_NOT_ALLOWED",
      },
    });
    expect(providerGet).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("rejects anonymous API token principals with the synthetic-principal code when formId is missing", async () => {
    validateApiToken.mockResolvedValueOnce({
      user_id: "anon:token-id",
      token_id: "token-id",
      scopes: ["read"],
      form_ids: [FORM_ID],
    });

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request("/discord/guilds", {
      headers: {
        authorization: "Bearer token-value",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "SYNTHETIC_PRINCIPAL_NOT_ALLOWED",
      },
    });
    expect(providerGet).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(guildsHandler).not.toHaveBeenCalled();
  });

  it("allows form owners to call service APIs with their own linked account", async () => {
    mockSession(OWNER_ID);
    mockDbSelectResults([
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ accountId: "discord-account-id", accessToken: "discord-token" }],
    ]);

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      accountId: "discord-account-id",
    });
    expect(eq).toHaveBeenCalledWith("account.userId", OWNER_ID);
  });

  it("does not expose provider handler exception messages", async () => {
    mockSession(OWNER_ID);
    mockDbSelectResults([[{ id: FORM_ID, creatorId: OWNER_ID }]]);
    guildsHandler.mockRejectedValueOnce(
      new Error("secret-internal-url=https://internal.example/token"),
    );

    const { externalServiceRouter } = await import(
      "../routes/external-service"
    );

    const res = await externalServiceRouter.request(
      `/discord/guilds?formId=${FORM_ID}`,
    );

    expect(res.status).toBe(502);
    const responseText = await res.text();
    expect(responseText).toContain("External service error");
    expect(responseText).not.toContain("secret-internal-url");
    expect(responseText).not.toContain("internal.example");
    expect(logError).toHaveBeenCalledWith(
      "External service API handler failed",
      "api",
      expect.objectContaining({
        errorName: "Error",
        provider: "discord",
        api: "guilds",
        formId: FORM_ID,
        userId: OWNER_ID,
      }),
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "secret-internal-url",
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "internal.example",
    );
  });
});
