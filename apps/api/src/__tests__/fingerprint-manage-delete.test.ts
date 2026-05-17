import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => {
  const db = {
    select: vi.fn(),
    delete: vi.fn(),
  };

  return {
    db,
    mockGetSession: vi.fn(),
    deleteWhere: vi.fn(),
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
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
  formResponse: {
    id: "formResponse.id",
    formId: "formResponse.formId",
  },
  fingerprintDetail: {
    id: "fingerprintDetail.id",
    responseId: "fingerprintDetail.responseId",
    fingerprintType: "fingerprintDetail.fingerprintType",
    componentName: "fingerprintDetail.componentName",
    componentValueHash: "fingerprintDetail.componentValueHash",
    collectedAt: "fingerprintDetail.collectedAt",
    expiresAt: "fingerprintDetail.expiresAt",
  },
}));

vi.mock("better-auth", () => ({
  betterAuth: () => ({
    handler: vi.fn().mockResolvedValue(new Response("ok")),
    api: { getSession: mocks.mockGetSession },
  }),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(),
}));

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
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
  lt: vi.fn((left, right) => ({ op: "lt", left, right })),
}));

function adminSession() {
  return {
    user: {
      id: "admin-user-id",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: true,
      isSuspended: false,
    },
    session: {
      id: "session-id",
      userId: "admin-user-id",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function mockFormResponses(rows: Array<{ id: string }>): void {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  mocks.db.select.mockReturnValue({ from });
}

describe("DELETE /manage fingerprint cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetSession.mockResolvedValue(adminSession());
    mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.db.delete.mockReturnValue({ where: mocks.deleteWhere });
  });

  it("returns deleted 0 and skips delete when formId has no responses", async () => {
    mockFormResponses([]);
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const res = await fingerprintRouter.request("/manage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId: "empty-form-id" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: 0 });
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });
});
