import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    update: vi.fn(() => ({
      set: mocks.updateSet.mockReturnValue({ where: mocks.updateWhere }),
    })),
  },
  form: {
    id: "form.id",
    publicId: "form.publicId",
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  externalServiceValidationResult: {},
  fingerprintDetail: {},
  formIntegration: {},
  formInvitation: {},
  formPermission: {},
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
        user_id: "user-1",
      });
      await next();
    };
  },
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: vi.fn(),
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

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
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

describe("POST /:id/regenerate-public-url rate limit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("returns 429 when public URL regenerations exceed the destructive mutation rate limit across forms", async () => {
    const { clearRateLimitStoreForTests } = await import("../lib/rate-limit");
    clearRateLimitStoreForTests();
    const { createHonoApp } = await import("../lib/hono");
    const { formsDetailRouter } = await import("../routes/forms-detail");
    const app = createHonoApp().route("/api/forms", formsDetailRouter);

    const responses: Response[] = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await app.request(`/api/forms/form-${i}/regenerate-public-url`, {
          method: "POST",
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
