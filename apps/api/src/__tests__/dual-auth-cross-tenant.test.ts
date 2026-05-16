import { describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
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
}));

import type { DualAuthContext } from "../lib/dual-auth";
import { checkFormAccess, checkFormPermissionLevel } from "../lib/dual-auth";
import { FormNotFoundError } from "../lib/errors/form-errors";

const FORM_ID = "form-xyz";
const OWNER_ID = "owner-user-id";
const OTHER_USER_ID = "other-user-id";

function mockDbCall(dbRaw: unknown, results: unknown[][]) {
  const db = dbRaw as { select: ReturnType<typeof vi.fn> };
  let callIdx = 0;
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => {
          const result = results[callIdx] ?? [];
          callIdx++;
          return Promise.resolve(result);
        }),
      }),
    }),
  }));
}

describe("C-1: api_token cross-tenant access prevention in checkFormPermissionLevel", () => {
  it("throws when user-scoped token user has no permission on the form", async () => {
    const { db } = await import("@nexus-form/database");
    // form lookup → OWNER_ID owns it; formPermission → empty
    mockDbCall(db, [[{ id: FORM_ID, creatorId: OWNER_ID }], []]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
      // no form_ids, no share_link_id → user-scoped token
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "VIEWER"),
    ).rejects.toThrow();
  });

  it("allows user-scoped token when user is the form creator", async () => {
    const { db } = await import("@nexus-form/database");
    // Form is owned by OTHER_USER_ID (the token's user)
    mockDbCall(db, [[{ id: FORM_ID, creatorId: OTHER_USER_ID }]]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["admin"],
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "OWNER"),
    ).resolves.toBeUndefined();
  });

  it("allows user-scoped token with EDITOR formPermission when VIEWER required", async () => {
    const { db } = await import("@nexus-form/database");
    // Form owned by OWNER_ID; OTHER_USER_ID has EDITOR permission
    mockDbCall(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "EDITOR" }],
    ]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "VIEWER"),
    ).resolves.toBeUndefined();
  });

  it("throws when user-scoped token with EDITOR permission requests OWNER access", async () => {
    const { db } = await import("@nexus-form/database");
    // Form owned by OWNER_ID; OTHER_USER_ID has EDITOR permission
    mockDbCall(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "EDITOR" }],
    ]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["admin"],
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "OWNER"),
    ).rejects.toThrow();
  });

  it("throws FormNotFoundError when the form does not exist", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbCall(db, [[]]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "VIEWER"),
    ).rejects.toThrow(FormNotFoundError);
  });

  it("throws when form_ids restriction excludes the requested form", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbCall(db, [[{ id: FORM_ID, creatorId: OWNER_ID }]]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
      form_ids: ["different-form-id"],
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "VIEWER"),
    ).rejects.toThrow();
  });

  it("denies anon token (user_id starts with 'anon:') even when form_ids passes", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbCall(db, [[{ id: FORM_ID, creatorId: OWNER_ID }]]);

    const ctx: DualAuthContext = {
      user_id: "anon:tok-abc",
      auth_type: "api_token",
      token_id: "tok-abc",
      scopes: ["read"],
      form_ids: [FORM_ID], // passes form_ids filter
    };

    await expect(
      checkFormPermissionLevel(ctx, FORM_ID, "VIEWER"),
    ).rejects.toThrow();
  });
});

describe("C-1: api_token cross-tenant access prevention in checkFormAccess", () => {
  it("returns false when user-scoped token has no DB access to form", async () => {
    const { db } = await import("@nexus-form/database");
    // form exists, owned by OWNER_ID; no formPermission for OTHER_USER_ID
    mockDbCall(db, [[{ id: FORM_ID, creatorId: OWNER_ID }], []]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
    };

    expect(await checkFormAccess(ctx, FORM_ID)).toBe(false);
  });

  it("returns true when user-scoped token user is the form creator", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbCall(db, [[{ id: FORM_ID, creatorId: OTHER_USER_ID }]]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
    };

    expect(await checkFormAccess(ctx, FORM_ID)).toBe(true);
  });

  it("returns true when user-scoped token user has a formPermission entry", async () => {
    const { db } = await import("@nexus-form/database");
    mockDbCall(db, [
      [{ id: FORM_ID, creatorId: OWNER_ID }],
      [{ role: "VIEWER" }],
    ]);

    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
    };

    expect(await checkFormAccess(ctx, FORM_ID)).toBe(true);
  });

  it("returns false for anon token regardless of form_ids", async () => {
    const ctx: DualAuthContext = {
      user_id: "anon:tok-abc",
      auth_type: "api_token",
      token_id: "tok-abc",
      scopes: ["read"],
    };

    // No DB call expected — anon is rejected before DB lookup
    expect(await checkFormAccess(ctx, FORM_ID)).toBe(false);
  });

  it("returns false when form_ids excludes the form", async () => {
    const ctx: DualAuthContext = {
      user_id: OTHER_USER_ID,
      auth_type: "api_token",
      token_id: "tok-1",
      scopes: ["read"],
      form_ids: ["other-form"],
    };

    expect(await checkFormAccess(ctx, FORM_ID)).toBe(false);
  });
});
