import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  and: vi.fn(),
  authContext: null as {
    auth_type: "api_token" | "session";
    user_id: string;
    token_id?: string;
    scopes?: string[];
    form_ids?: string[];
  } | null,
  countWhere: vi.fn(),
  createdLimit: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  findMany: vi.fn(),
  inArray: vi.fn(),
  insertValues: vi.fn(),
}));

const baseForm = {
  id: "allowed-form",
  publicId: "public-1",
  title: "Allowed form",
  description: null,
  creatorId: "user-1",
  status: "DRAFT",
  publishedAt: null,
  unpublishedAt: null,
  allowEditResponses: false,
  createdAt: new Date("2026-05-21T00:00:00.000Z"),
  updatedAt: new Date("2026-05-21T00:00:00.000Z"),
  version: 1,
  plateContent: null,
  plateContentVersion: 1,
  baseSnapshotVersion: null,
};

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: vi.fn(() => ({
      values: mocks.insertValues,
    })),
    query: {
      form: {
        findMany: mocks.findMany,
      },
    },
    select: vi.fn((selection?: unknown) => {
      if (selection) {
        return {
          from: vi.fn(() => ({
            where: mocks.countWhere,
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: mocks.createdLimit,
          })),
        })),
      };
    }),
  },
  form: {
    creatorId: "form.creatorId",
    id: "form.id",
    updatedAt: "form.updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => {
    const value = { conditions, type: "and" };
    mocks.and(...conditions);
    return value;
  },
  count: () => "count",
  desc: (column: unknown) => {
    const value = { column, type: "desc" };
    mocks.desc(column);
    return value;
  },
  eq: (column: unknown, value: unknown) => {
    const condition = { column, type: "eq", value };
    mocks.eq(column, value);
    return condition;
  },
  inArray: (column: unknown, values: unknown[]) => {
    const condition = { column, type: "inArray", values };
    mocks.inArray(column, values);
    return condition;
  },
}));

vi.mock("../lib/dual-auth", () => ({
  withDualAuth: (requiredScopes: string[] = []) => {
    return async (
      c: {
        json: (body: unknown, status?: number) => Response;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      const auth = mocks.authContext;
      if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
      if (auth.auth_type === "api_token") {
        const scopes = auth.scopes ?? [];
        const allowed = requiredScopes.every(
          (scope) => scopes.includes(scope) || scopes.includes("admin"),
        );
        if (!allowed) {
          return c.json(
            { error: { message: "Insufficient permissions" } },
            403,
          );
        }
      }
      c.set("dualAuthContext", auth);
      await next();
    };
  },
}));

describe("R9-C2 forms API token authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.authContext = null;
    mocks.countWhere.mockResolvedValue([{ count: 1 }]);
    mocks.createdLimit.mockResolvedValue([baseForm]);
    mocks.findMany.mockResolvedValue([baseForm]);
    mocks.insertValues.mockResolvedValue(undefined);
  });

  it("rejects read-only API tokens before creating forms", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "user-1",
      token_id: "token-1",
      scopes: ["read"],
    };

    const { formsRouter } = await import("../routes/forms");
    const response = await formsRouter.request("/", {
      body: JSON.stringify({ title: "New form" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("allows write API tokens to create forms", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "user-1",
      token_id: "token-1",
      scopes: ["write"],
    };

    const { formsRouter } = await import("../routes/forms");
    const response = await formsRouter.request("/", {
      body: JSON.stringify({ title: "New form" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: "user-1",
        status: "DRAFT",
        title: "New form",
      }),
    );
    expect(body).toMatchObject({ form: { id: "allowed-form" } });
  });

  it("rejects form-scoped write API tokens before creating forms", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "user-1",
      token_id: "token-1",
      scopes: ["write"],
      form_ids: ["allowed-form"],
    };

    const { formsRouter } = await import("../routes/forms");
    const response = await formsRouter.request("/", {
      body: JSON.stringify({ title: "New form" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("restricts GET /api/forms to API token form_ids", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "user-1",
      token_id: "token-1",
      scopes: ["read"],
      form_ids: ["allowed-form"],
    };

    const { formsRouter } = await import("../routes/forms");
    const response = await formsRouter.request("/?page=1&limit=50");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith("form.creatorId", "user-1");
    expect(mocks.inArray).toHaveBeenCalledWith("form.id", ["allowed-form"]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        offset: 0,
        where: expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              type: "inArray",
              values: ["allowed-form"],
            }),
          ]),
          type: "and",
        }),
      }),
    );
    expect(body).toMatchObject({
      forms: [{ id: "allowed-form" }],
      pagination: { limit: 50, page: 1, total: 1, totalPages: 1 },
    });
  });
});
