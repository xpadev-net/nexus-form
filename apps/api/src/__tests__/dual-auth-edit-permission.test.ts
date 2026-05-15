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
import { hasEditPermission } from "../lib/dual-auth";

const FORM_ID = "form-xyz";

describe("hasEditPermission (H-2)", () => {
  it("returns false for a session user who is not a form creator or editor", async () => {
    const { db } = await import("@nexus-form/database");
    // form exists but user is not creator
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValueOnce([{ id: FORM_ID, creatorId: "other-user" }]),
        }),
      }),
    });

    const context: DualAuthContext = {
      user_id: "current-user",
      auth_type: "session",
      session: {
        user: { id: "current-user" },
        session: { id: "sess-1" },
      },
    };

    // Second select call for formPermission returns empty (no explicit permission)
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValueOnce([
                { id: FORM_ID, creatorId: "other-user" },
              ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

    const result = await hasEditPermission(context, FORM_ID);
    expect(result).toBe(false);
  });

  it("returns true for a session user who is the form creator", async () => {
    const { db } = await import("@nexus-form/database");
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValueOnce([
              { id: FORM_ID, creatorId: "current-user" },
            ]),
        }),
      }),
    });

    const context: DualAuthContext = {
      user_id: "current-user",
      auth_type: "session",
      session: {
        user: { id: "current-user" },
        session: { id: "sess-1" },
      },
    };

    const result = await hasEditPermission(context, FORM_ID);
    expect(result).toBe(true);
  });
});
