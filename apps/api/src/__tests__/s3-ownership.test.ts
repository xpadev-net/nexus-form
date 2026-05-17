import { beforeAll, describe, expect, it, vi } from "vitest";
import { s3ImageService } from "../lib/s3/image-service";
import { SecurityValidationError } from "../lib/s3/validation";

vi.mock("../load-env", () => ({}));

const mockGetSession = vi.fn();

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
  discordGuild: {},
  discordUser: {},
}));

vi.mock("better-auth", () => ({
  betterAuth: () => ({
    handler: vi.fn().mockResolvedValue(new Response("ok")),
    api: { getSession: mockGetSession },
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

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn(), close: vi.fn() })),
  Worker: vi.fn().mockImplementation(() => ({ close: vi.fn() })),
}));

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
  desc: vi.fn(),
  and: vi.fn(),
  count: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../lib/rate-limit", () => {
  const passThrough = async (_c: unknown, next: () => Promise<void>) => next();
  return {
    createRateLimit: vi.fn(() => passThrough),
    getClientIp: vi.fn(() => "127.0.0.1"),
    authRouteRateLimiter: passThrough,
    generalRateLimiter: passThrough,
  };
});

// Mock S3 services so no real AWS calls are made
vi.mock("../lib/s3/image-service", () => ({
  s3ImageService: {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    moveToProd: vi.fn().mockResolvedValue({
      key: "prod/users/user-a/file.jpg",
      bucket: "prod-bucket",
      url: "",
      size: 0,
      contentType: "",
    }),
    objectExists: vi.fn().mockResolvedValue(true),
    generateDownloadUrl: vi.fn().mockResolvedValue({
      url: "https://s3.example.com/file",
      key: "prod/users/user-a/file.jpg",
      expiresIn: 3600,
    }),
    generateUploadUrl: vi.fn().mockResolvedValue({
      url: "https://s3.example.com/file",
      key: "tmp/users/user-a/file.jpg",
      expiresIn: 3600,
    }),
    processAndMoveImage: vi.fn().mockResolvedValue({
      key: "prod/users/user-a/file.jpg",
      bucket: "prod-bucket",
      url: "",
      size: 0,
      contentType: "",
    }),
  },
}));

vi.mock("../lib/s3/base-service", () => ({
  s3BaseService: {
    objectExists: vi.fn().mockResolvedValue(true),
    generateDownloadUrl: vi.fn().mockResolvedValue({
      url: "https://s3.example.com/file",
      key: "prod/users/user-a/file.jpg",
      expiresIn: 3600,
    }),
    generatePresignedPutUrl: vi
      .fn()
      .mockResolvedValue("https://s3.example.com/upload"),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    moveToProd: vi.fn().mockResolvedValue({
      key: "prod/users/user-a/file.jpg",
      bucket: "prod-bucket",
      url: "",
      size: 0,
      contentType: "",
    }),
  },
}));

vi.mock("../lib/s3/client", () => ({
  getS3Client: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({ Contents: [], IsTruncated: false }),
  }),
}));

const USER_A_ID = "user-a-id";
const USER_B_ID = "user-b-id";

function sessionFor(userId: string) {
  return {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: userId,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: true,
      isSuspended: false,
    },
    session: {
      id: "session-1",
      userId,
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

let app: Awaited<typeof import("../index")>["default"];

beforeAll(async () => {
  const mod = await import("../index");
  app = mod.default;
});

describe("S3 key ownership enforcement (H-1)", () => {
  describe("DELETE /api/s3/delete", () => {
    it("returns 403 when deleting another user's key", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `prod/users/${USER_B_ID}/file.jpg` }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 for path traversal key", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `prod/users/${USER_A_ID}/../${USER_B_ID}/file.jpg`,
        }),
      });
      expect(res.status).toBe(403);
    });

    it("proceeds (not 403) when deleting own key", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `prod/users/${USER_A_ID}/file.jpg` }),
      });
      expect(res.status).not.toBe(403);
    });

    it("proceeds (not 403) for double-dot filenames in own namespace", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `prod/users/${USER_A_ID}/file..backup.jpg`,
        }),
      });
      expect(res.status).not.toBe(403);
    });

    it("returns 400 when deleting a tmp key from the prod bucket", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `tmp/users/${USER_A_ID}/file.jpg`,
          bucket: "prod",
        }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Object key must start with prod/",
      });
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValueOnce(null);
      const res = await app.request("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `prod/users/${USER_A_ID}/file.jpg` }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/s3/move", () => {
    it("returns 403 when moving another user's key", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmpKey: `tmp/users/${USER_B_ID}/file.jpg` }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when finalKey belongs to another user", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmpKey: `tmp/users/${USER_A_ID}/file.jpg`,
          finalKey: `prod/users/${USER_B_ID}/file.jpg`,
        }),
      });
      expect(res.status).toBe(403);
    });

    it("proceeds (not 403) when moving own key", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmpKey: `tmp/users/${USER_A_ID}/file.jpg` }),
      });
      expect(res.status).not.toBe(403);
    });

    it("returns 400 when finalKey uses the temporary namespace", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmpKey: `tmp/users/${USER_A_ID}/file.jpg`,
          finalKey: `tmp/users/${USER_A_ID}/file.jpg`,
        }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Object key must start with prod/",
      });
    });

    it("returns 400 when service defense-in-depth rejects move keys", async () => {
      vi.mocked(s3ImageService.moveToProd).mockRejectedValueOnce(
        new SecurityValidationError("Object key validation failed", [
          "Object key contains unsafe path segments",
        ]),
      );
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));

      const res = await app.request("/api/s3/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmpKey: `tmp/users/${USER_A_ID}/file.jpg`,
          finalKey: `prod/users/${USER_A_ID}/file.jpg`,
        }),
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Object key validation failed",
      });
    });
  });

  describe("GET /api/s3/list", () => {
    it("returns 403 when listing another user's prefix", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request(
        `/api/s3/list?prefix=prod%2Fusers%2F${USER_B_ID}%2F`,
      );
      expect(res.status).toBe(403);
    });

    it("proceeds (not 403) with no prefix (server enforces own namespace)", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request("/api/s3/list");
      expect(res.status).not.toBe(403);
    });

    it("proceeds (not 403) when listing own prefix", async () => {
      mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
      const res = await app.request(
        `/api/s3/list?prefix=prod%2Fusers%2F${USER_A_ID}%2F`,
      );
      expect(res.status).not.toBe(403);
    });
  });
});

describe("R3-H22: S3 route rejects bucket/key role mismatches", () => {
  it("returns 400 when upload-complete checks a prod key in the tmp bucket", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const res = await app.request("/api/s3/upload-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: `prod/users/${USER_A_ID}/file.jpg`,
        bucket: "tmp",
        size: 123,
        contentType: "image/jpeg",
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Object key must start with tmp/",
    });
  });

  it("returns 400 when a prod presigned URL is requested for a tmp key", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const key = encodeURIComponent(`tmp/users/${USER_A_ID}/file.jpg`);
    const res = await app.request(
      `/api/s3/presigned-url?bucket=prod&key=${key}`,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Object key must start with prod/",
    });
  });

  it("returns 400 when process-image receives a prod tmpKey", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const res = await app.request("/api/s3/process-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tmpKey: `prod/users/${USER_A_ID}/file.jpg`,
      }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Object key must start with tmp/",
    });
  });

  it("returns 400 when service defense-in-depth rejects process-image keys", async () => {
    vi.mocked(s3ImageService.processAndMoveImage).mockRejectedValueOnce(
      new SecurityValidationError("Object key validation failed", [
        "Object key contains unsafe path segments",
      ]),
    );
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));

    const res = await app.request("/api/s3/process-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tmpKey: `tmp/users/${USER_A_ID}/file.jpg`,
        finalKey: `prod/users/${USER_A_ID}/file.jpg`,
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Object key validation failed",
    });
  });
});

describe("C-2: S3 proxy route requires authentication and ownership (regression)", () => {
  it("returns 401 for unauthenticated request to proxy route", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await app.request(
      `/api/s3/proxy/prod/users/${USER_A_ID}/file.jpg`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when accessing another user's key via proxy", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const res = await app.request(
      `/api/s3/proxy/prod/users/${USER_B_ID}/file.jpg`,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for path-traversal key via proxy (format check before ownership)", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    // Route rejects '..' in key with 400 before reaching the ownership check.
    const encodedKey = encodeURIComponent(
      `users/${USER_A_ID}/../${USER_B_ID}/file.jpg`,
    );
    const res = await app.request(`/api/s3/proxy/prod/${encodedKey}`);
    expect(res.status).toBe(400);
  });

  it("redirects (302) when accessing own key via proxy", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const res = await app.request(
      `/api/s3/proxy/prod/users/${USER_A_ID}/file.jpg`,
    );
    // Ownership check passes → 302 redirect to presigned URL
    expect(res.status).toBe(302);
  });

  it("redirects (302) for double-dot filenames in own namespace via proxy", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const res = await app.request(
      `/api/s3/proxy/prod/users/${USER_A_ID}/file..backup.jpg`,
    );
    expect(res.status).toBe(302);
  });

  it("returns 400 for invalid bucket alias via proxy", async () => {
    mockGetSession.mockResolvedValueOnce(sessionFor(USER_A_ID));
    const res = await app.request(
      `/api/s3/proxy/invalid/users/${USER_A_ID}/file.jpg`,
    );
    expect(res.status).toBe(400);
  });
});
