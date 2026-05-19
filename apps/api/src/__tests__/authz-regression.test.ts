/**
 * Authz Regression Tests — R2-C1, R2-H1, R2-H2, R2-H3
 *
 * R2-C1: VIEWER cannot retrieve share-link token values (EDITOR gate)
 * R2-H1: VIEWER session cannot save fingerprints (EDITOR gate via hasEditPermission)
 * R2-H2: Response limit is enforced inside an atomic transaction (TOCTOU prevention)
 * R2-H3: VIEWER cannot list permissions or invitations (EDITOR gate)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    for: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
  },
  user: {},
  session: {},
  account: {},
  verificationToken: {},
  form: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  form: {},
  formPermission: {},
  formShareLink: {},
  formResponse: {},
  fingerprintDetail: {},
  formInvitation: {},
  formStructure: {},
  formIntegration: {},
  externalServiceValidationResult: {},
}));

vi.mock("../lib/security/hcaptcha", () => ({
  verifyHCaptcha: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/telemetry/tokens", () => ({
  consumeTokensOrThrow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/sessions/jwt", () => ({
  extractJwtFromRequest: vi.fn().mockReturnValue(null),
  resolveSessionIdOrCreate: vi
    .fn()
    .mockResolvedValue({ sessionId: "s1", jwt: "tok" }),
  signSessionJwt: vi.fn().mockReturnValue("tok"),
  verifySessionJwt: vi.fn().mockReturnValue(null),
}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: vi.fn().mockReturnValue(undefined),
    getAll: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("better-auth", () => ({
  betterAuth: () => ({
    handler: vi.fn(),
    api: { getSession: vi.fn().mockResolvedValue(null) },
  }),
}));

vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: vi.fn() }));

vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    disconnect: vi.fn(),
    quit: vi.fn(),
  }));
  return { default: RedisMock, Redis: RedisMock };
});

vi.mock("pino", () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn(() => logger) };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  count: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  lt: vi.fn(),
}));

const FORM_ID = "form-authz-regression";
const OWNER_ID = "owner-user-id";
const VIEWER_ID = "viewer-user-id";
const EDITOR_ID = "editor-user-id";

function mockDbSelectChain(dbRaw: unknown, resultSets: unknown[][]): void {
  const db = dbRaw as { select: ReturnType<typeof vi.fn> };
  let callIdx = 0;
  const nextResult = () => {
    const result = resultSets[callIdx] ?? [];
    callIdx++;
    return Promise.resolve(result);
  };
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(nextResult),
        for: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(nextResult),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(nextResult),
        }),
      }),
    }),
  }));
}

import type { DualAuthContext } from "../lib/dual-auth";

// ── R2-C1: Share-link token exposure prevention ─────────────────────────────

describe("R2-C1: VIEWER cannot access share-links (EDITOR gate)", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("throws for session VIEWER when EDITOR is required", async () => {
    const { db } = await import("@nexus-form/database");
    // form found; VIEWER permission for the user
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "VIEWER" }],
    ]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const viewerCtx: DualAuthContext = {
      user_id: VIEWER_ID,
      auth_type: "session",
    };

    await expect(
      checkFormPermissionLevel(viewerCtx, FORM_ID, "EDITOR"),
    ).rejects.toThrow();
  });

  it("resolves for session EDITOR when EDITOR is required", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "EDITOR" }],
    ]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const editorCtx: DualAuthContext = {
      user_id: EDITOR_ID,
      auth_type: "session",
    };

    await expect(
      checkFormPermissionLevel(editorCtx, FORM_ID, "EDITOR"),
    ).resolves.toBeUndefined();
  });

  it("throws for share-link VIEWER token when EDITOR is required", async () => {
    const { db } = await import("@nexus-form/database");
    // form found; share-link found with VIEWER role and active
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ id: "link-viewer", role: "VIEWER", isActive: true, formId: FORM_ID }],
    ]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const shareViewerCtx: DualAuthContext = {
      user_id: "anon:tok-viewer",
      auth_type: "api_token",
      token_id: "tok-viewer",
      scopes: ["read"],
      share_link_id: "link-viewer",
    };

    await expect(
      checkFormPermissionLevel(shareViewerCtx, FORM_ID, "EDITOR"),
    ).rejects.toThrow();
  });

  it("resolves for non-expired share-link token when the role matches", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [
        {
          id: "link-active",
          role: "EDITOR",
          isActive: true,
          formId: FORM_ID,
          expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        },
      ],
    ]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const activeShareLinkCtx: DualAuthContext = {
      user_id: "anon:tok-active",
      auth_type: "api_token",
      token_id: "tok-active",
      scopes: ["read", "write"],
      share_link_id: "link-active",
    };

    await expect(
      checkFormPermissionLevel(activeShareLinkCtx, FORM_ID, "EDITOR"),
    ).resolves.toBeUndefined();
  });

  it("throws for expired share-link token even when the role matches", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [
        {
          id: "link-expired",
          role: "EDITOR",
          isActive: true,
          formId: FORM_ID,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ],
    ]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const expiredShareLinkCtx: DualAuthContext = {
      user_id: "anon:tok-expired",
      auth_type: "api_token",
      token_id: "tok-expired",
      scopes: ["read", "write"],
      share_link_id: "link-expired",
    };

    await expect(
      checkFormPermissionLevel(expiredShareLinkCtx, FORM_ID, "EDITOR"),
    ).rejects.toThrow();
  });

  it("returns false for expired share-link token form access", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [
        {
          id: "link-expired",
          role: "VIEWER",
          isActive: true,
          formId: FORM_ID,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ],
    ]);

    const { checkFormAccess } = await import("../lib/dual-auth");
    const expiredShareLinkCtx: DualAuthContext = {
      user_id: "anon:tok-expired",
      auth_type: "api_token",
      token_id: "tok-expired",
      scopes: ["read"],
      share_link_id: "link-expired",
    };

    expect(await checkFormAccess(expiredShareLinkCtx, FORM_ID)).toBe(false);
  });
});

// ── R2-H1: Fingerprint save is gated to EDITOR ──────────────────────────────

describe("R2-H1: Fingerprint /save is blocked for VIEWER (hasEditPermission)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns false when session user has VIEWER role", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "VIEWER" }],
    ]);

    const { hasEditPermission } = await import("../lib/dual-auth");
    const viewerCtx: DualAuthContext = {
      user_id: VIEWER_ID,
      auth_type: "session",
    };

    expect(await hasEditPermission(viewerCtx, FORM_ID)).toBe(false);
  });

  it("returns true when session user has EDITOR role", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "EDITOR" }],
    ]);

    const { hasEditPermission } = await import("../lib/dual-auth");
    const editorCtx: DualAuthContext = {
      user_id: EDITOR_ID,
      auth_type: "session",
    };

    expect(await hasEditPermission(editorCtx, FORM_ID)).toBe(true);
  });

  it("returns false for api_token missing write/admin scope — DB is never consulted", async () => {
    const { db } = await import("@nexus-form/database");
    // Capture baseline before the call so accumulated prior-test counts don't interfere.
    const dbSelect = (db as unknown as { select: ReturnType<typeof vi.fn> })
      .select;
    const callsBefore = dbSelect.mock.calls.length;

    const { hasEditPermission } = await import("../lib/dual-auth");
    const readOnlyTokenCtx: DualAuthContext = {
      user_id: EDITOR_ID,
      auth_type: "api_token",
      token_id: "tok-readonly",
      scopes: ["read"],
    };

    expect(await hasEditPermission(readOnlyTokenCtx, FORM_ID)).toBe(false);
    // scope check short-circuits at line 610 of dual-auth.ts before any DB call
    expect(dbSelect.mock.calls.length).toBe(callsBefore);
  });
});

// ── R2-H2: Response limit TOCTOU — count check is inside a locked transaction ─

describe("R2-H2: Response-limit count check runs inside a db.transaction()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("db.transaction is called during submit when the form has a response limit", async () => {
    const { db } = await import("@nexus-form/database");

    // form found (PUBLISHED), then formStructure containing the response limit
    mockDbSelectChain(db, [
      [{ id: FORM_ID, status: "PUBLISHED", plateContent: "[]" }],
      [
        {
          structureJson: JSON.stringify({
            settings: { response_limit: { enabled: true, max_responses: 100 } },
          }),
        },
      ],
    ]);

    // txSelectSpy witnesses every SELECT that runs inside the transaction.
    // If a future change moves the count check outside the transaction,
    // txSelectSpy sees zero calls and the test fails — catching the TOCTOU regression.
    const txSelectSpy = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          // Awaitable as-is (count check) and supports .for("update") (lock query).
          Object.assign(Promise.resolve([{ count: 0 }]), {
            for: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    });
    const txMock = {
      select: txSelectSpy,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const txSpy = vi.spyOn(
      db as { transaction: (fn: (tx: unknown) => unknown) => unknown },
      "transaction",
    );
    txSpy.mockImplementation(async (fn) => fn(txMock));

    const { formsPublicRouter } = await import("../routes/forms-public");

    await formsPublicRouter.request(`/public/test-public-id/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        responses: [],
        captchaToken: "test-captcha-token",
        telemetry: { v4Token: "tok-v4" },
        fingerprints: [{ type: "browser", name: "fp1", value_hash: "h1" }],
      }),
    });

    expect(txSpy).toHaveBeenCalledOnce();
    // Verify both the FOR UPDATE lock SELECT and the count SELECT ran inside the
    // transaction. toHaveBeenCalledTimes(2) catches the TOCTOU regression where
    // only the count check is moved outside — toHaveBeenCalled() would still pass.
    expect(txSelectSpy).toHaveBeenCalledTimes(2);
    txSpy.mockRestore();
  });

  it("formRoleSatisfies: EDITOR satisfies VIEWER requirement (inverse covered by R2-C1/R2-H3)", async () => {
    // R2-H2 fix also gated the submit path at form-level auth.
    // Verify the role hierarchy correctly prevents cross-level access.
    const { db } = await import("@nexus-form/database");

    // EDITOR context passes VIEWER check
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "EDITOR" }],
    ]);
    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const editorCtx: DualAuthContext = {
      user_id: EDITOR_ID,
      auth_type: "session",
    };
    await expect(
      checkFormPermissionLevel(editorCtx, FORM_ID, "VIEWER"),
    ).resolves.toBeUndefined();
  });
});

// ── R3-H3: Captcha gates public submit validation and DB work ────────────────

describe("R3-H3: hCaptcha is verified before public submit work", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects invalid captcha before form lookup, schedule processing, or answer validation", async () => {
    const { db } = await import("@nexus-form/database");
    const { verifyHCaptcha } = await import("../lib/security/hcaptcha");
    const { processFormSchedule } = await import(
      "../lib/forms/schedule-processor"
    );
    const { getLatestSnapshot } = await import(
      "../lib/forms/snapshot-repository"
    );

    vi.mocked(verifyHCaptcha).mockResolvedValueOnce(false);
    const transactionSpy = vi.spyOn(
      db as { transaction: (fn: (tx: unknown) => unknown) => unknown },
      "transaction",
    );

    const { formsPublicRouter } = await import("../routes/forms-public");

    const res = await formsPublicRouter.request(
      "/public/test-public-id/submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: [
            {
              question_id: "unknown-question",
              question_type: "short_text",
              value: "should-not-be-validated",
            },
          ],
          captchaToken: "invalid-captcha-token",
          telemetry: { v4Token: "tok-v4" },
          fingerprints: [{ type: "browser", name: "fp1", value_hash: "h1" }],
        }),
      },
    );

    expect(res.status).toBe(403);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
    expect(processFormSchedule).not.toHaveBeenCalled();
    expect(getLatestSnapshot).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
    transactionSpy.mockRestore();
  });
});

// ── R3-M21: Password protection fails closed when misconfigured ─────────────

describe("R3-M21: password protected public submit fails closed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects submission when password protection is enabled without a password hash", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, status: "PUBLISHED", plateContent: "[]" }],
      [
        {
          structureJson: JSON.stringify({
            access_control: {
              password_protection: {
                enabled: true,
                password_hint: "hint",
              },
            },
          }),
        },
      ],
    ]);
    const transactionSpy = vi.spyOn(
      db as { transaction: (fn: (tx: unknown) => unknown) => unknown },
      "transaction",
    );

    const { formsPublicRouter } = await import("../routes/forms-public");

    const res = await formsPublicRouter.request(
      "/public/test-public-id/submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: [],
          captchaToken: "test-captcha-token",
          telemetry: { v4Token: "tok-v4" },
          fingerprints: [],
        }),
      },
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Form password protection is misconfigured",
    });
    expect(transactionSpy).not.toHaveBeenCalled();
    transactionSpy.mockRestore();
  });

  it("rejects password verification when protection is enabled without a password hash", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID }],
      [
        {
          structureJson: JSON.stringify({
            access_control: {
              password_protection: {
                enabled: true,
                password_hint: "hint",
              },
            },
          }),
        },
      ],
    ]);

    const { formsPublicRouter } = await import("../routes/forms-public");

    const res = await formsPublicRouter.request(
      "/public/test-public-id/verify-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "candidate-password" }),
      },
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Form password protection is misconfigured",
    });
  });
});

// ── R2-H3: Permissions and Invitations require EDITOR, not VIEWER ────────────

describe("R2-H3: VIEWER cannot list permissions or invitations", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws when session VIEWER requests EDITOR-gated endpoint", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbSelectChain(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "VIEWER" }],
    ]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const viewerCtx: DualAuthContext = {
      user_id: VIEWER_ID,
      auth_type: "session",
    };

    // GET /:id/permissions and GET /:id/invitations are gated to EDITOR
    await expect(
      checkFormPermissionLevel(viewerCtx, FORM_ID, "EDITOR"),
    ).rejects.toThrow();
  });

  it("resolves when session OWNER accesses EDITOR-gated endpoint", async () => {
    const { db } = await import("@nexus-form/database");
    // Creator → OWNER
    mockDbSelectChain(db, [[{ id: FORM_ID, creatorId: OWNER_ID }]]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const ownerCtx: DualAuthContext = {
      user_id: OWNER_ID,
      auth_type: "session",
    };

    await expect(
      checkFormPermissionLevel(ownerCtx, FORM_ID, "EDITOR"),
    ).resolves.toBeUndefined();
  });

  it("throws when user has no permission at all on the form", async () => {
    const { db } = await import("@nexus-form/database");
    // Form found; no permission row for the user
    mockDbSelectChain(db, [[{ id: FORM_ID, creatorId: OWNER_ID }], []]);

    const { checkFormPermissionLevel } = await import("../lib/dual-auth");
    const noAccessCtx: DualAuthContext = {
      user_id: "no-access-user",
      auth_type: "session",
    };

    await expect(
      checkFormPermissionLevel(noAccessCtx, FORM_ID, "VIEWER"),
    ).rejects.toThrow();
  });
});
