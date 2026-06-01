import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  formUpdateWhere: vi.fn(),
  integrationUpdateSet: vi.fn(),
  integrationUpdateWhere: vi.fn(),
  insertPermissionValues: vi.fn(),
  txUpdate: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  form: {
    id: "form.id",
    creatorId: "form.creatorId",
  },
  user: {
    id: "user.id",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  externalServiceValidationResult: {},
  fingerprintDetail: {},
  formIntegration: {
    formId: "formIntegration.formId",
  },
  formInvitation: {},
  formPermission: {
    formId: "formPermission.formId",
    userId: "formPermission.userId",
    role: "formPermission.role",
  },
  formResponse: {},
  formSchedule: {},
  formShareLink: {},
  formSnapshot: {},
  formStructure: {},
  formValidationRule: {},
  formValidationRuleBlock: {},
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "old-owner-user-id",
      });
      await next();
    };
  },
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: vi.fn(),
}));

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
}));

vi.mock("../lib/forms/schedule-error-logging", () => ({
  logFormScheduleError: vi.fn(),
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: vi.fn(),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: vi.fn(),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
}));

describe("POST /:id/transfer-ownership integration ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.db.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "new-owner-user-id" }]),
    });

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ creatorId: "old-owner-user-id" }]),
      })),
      update: mocks.txUpdate.mockImplementation(() => ({
        set: vi.fn((values: unknown) => {
          if (
            typeof values === "object" &&
            values !== null &&
            "ownerUserId" in values
          ) {
            mocks.integrationUpdateSet(values);
            return {
              where: mocks.integrationUpdateWhere.mockResolvedValue(undefined),
            };
          }

          return {
            where: mocks.formUpdateWhere.mockResolvedValue(values),
          };
        }),
      })),
      insert: vi.fn(() => ({
        values: mocks.insertPermissionValues.mockReturnValue({
          onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      })),
    };

    mocks.db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
  });

  it("moves existing Google Sheets integration ownership to the new owner in the transfer transaction", async () => {
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request(
      "/form-1/transfer-ownership",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: "new-owner-user-id" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ownerUserId: "new-owner-user-id",
    });
    expect(mocks.integrationUpdateSet).toHaveBeenCalledWith({
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });
  });

  it("returns 429 when ownership transfers exceed the destructive mutation rate limit", async () => {
    const { clearRateLimitStoreForTests } = await import("../lib/rate-limit");
    clearRateLimitStoreForTests();
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const responses: Response[] = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await formsDetailRouter.request("/form-1/transfer-ownership", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newOwnerUserId: "new-owner-user-id" }),
        }),
      );
    }

    for (const allowed of responses.slice(0, 10)) {
      expect(allowed.status).not.toBe(429);
    }

    const limited = responses[10];
    if (!limited) throw new Error("Expected a rate-limited response");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(limited.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    await expect(limited.json()).resolves.toMatchObject({
      error: { message: "Too many requests" },
    });
  });
});
