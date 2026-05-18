import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock load-env to prevent dotenv side effects
vi.mock("../load-env", () => ({}));

// Mock @nexus-form/database to avoid real DB connections
vi.mock("@nexus-form/database", () => ({
  db: {
    query: {
      form: { findMany: vi.fn().mockResolvedValue([]) },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
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
  discordGuild: {},
  discordUser: {},
}));

// Mock better-auth to avoid initialization with real credentials
vi.mock("better-auth", () => ({
  betterAuth: () => ({
    handler: vi.fn().mockResolvedValue(new Response("ok")),
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  }),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(),
}));

// Mock ioredis
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

// Mock bullmq
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    close: vi.fn(),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
  })),
}));

// Mock pino logger
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

// Mock drizzle-orm (eq, desc, and, count)
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  count: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));

let app: Awaited<typeof import("../index")>["default"];

beforeAll(async () => {
  const mod = await import("../index");
  app = mod.default;
});

describe("API Route Integration Tests", () => {
  describe("GET /api/health", () => {
    it("should return 200 with status ok", async () => {
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string; timestamp: string };
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
    });

    it("should include a valid ISO timestamp", async () => {
      const res = await app.request("/api/health");
      const body = (await res.json()) as { timestamp: string };
      const parsed = new Date(body.timestamp);
      expect(parsed.toISOString()).toBe(body.timestamp);
    });
  });

  describe("GET /api/csrf", () => {
    it("should return 200 with token information", async () => {
      const res = await app.request("/api/csrf");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { token: string; note: string };
      expect(body.token).toBe("better-auth-managed");
      expect(body.note).toBeDefined();
    });
  });

  describe("GET /api/auth-ext/me", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/auth-ext/me");
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    });

    it("should allow authenticated users with a null display name", async () => {
      const { auth } = await import("../lib/auth");
      const sessionResult = {
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "",
          role: "user",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          emailVerified: true,
          image: null,
          isSuspended: false,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          token: "session-token",
          expiresAt: new Date("2026-02-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      };
      Object.defineProperty(sessionResult.user, "name", { value: null });
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(sessionResult);

      const res = await app.request("/api/auth-ext/me");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        user: { name: string | null; createdAt: string; updatedAt: string };
      };
      expect(body.user.name).toBeNull();
      expect(body.user.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(body.user.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    });
  });

  describe("POST /api/auth-ext/me", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/auth-ext/me", {
        method: "POST",
      });
      // GET /me exists as a route; POST /me does not — either 401 or 404/405 is acceptable
      expect([401, 404, 405]).toContain(res.status);
    });
  });

  describe("GET /api/forms", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/forms");
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  describe("POST /api/forms", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test Form" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/tokens", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/tokens");
      expect(res.status).toBe(401);

      const body = (await res.json()) as {
        error: { message: string; code: string };
      };
      expect(body.error).toBeDefined();
    });
  });

  describe("POST /api/tokens", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test-token",
          scopes: ["read"],
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Security headers", () => {
    it("should include X-Content-Type-Options header", async () => {
      const res = await app.request("/api/health");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("should include X-Frame-Options header", async () => {
      const res = await app.request("/api/health");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    });

    it("should include Referrer-Policy header", async () => {
      const res = await app.request("/api/health");
      expect(res.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
    });
  });

  describe("DELETE /api/forms/:id/blocks/sessions/:sessionId", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request(
        "/api/forms/form-1/blocks/sessions/session-1",
        { method: "DELETE" },
      );
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/forms/:id/blocks/sessions", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await app.request("/api/forms/form-1/blocks/sessions", {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Non-existent routes", () => {
    it("should return 404 for unknown paths", async () => {
      const res = await app.request("/api/non-existent-route");
      expect(res.status).toBe(404);
    });
  });
});
