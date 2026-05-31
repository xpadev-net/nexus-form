import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  getLatestSnapshot: vi.fn(),
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
    status: "form.status",
    publishedAt: "form.publishedAt",
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

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
  getClientIp: () => "127.0.0.1",
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
  getLatestSnapshot: mocks.getLatestSnapshot,
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

describe("POST /:id/publish", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("returns 400 without publishing when the active snapshot JSON is malformed", async () => {
    mocks.getLatestSnapshot.mockResolvedValue({
      id: "snapshot-1",
      formId: "form-1",
      version: 1,
      plateContent: "{not-json",
      validationRulesJson: "[]",
      structureJson: "{}",
      isActive: true,
      publishedBy: "user-1",
      publishedAt: new Date("2026-05-31T00:00:00.000Z"),
      title: "Broken snapshot",
    });

    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request("/form-1/publish", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "公開用スナップショットの形式が不正です",
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("returns 400 without publishing when the active snapshot JSON is not an array", async () => {
    mocks.getLatestSnapshot.mockResolvedValue({
      id: "snapshot-1",
      formId: "form-1",
      version: 1,
      plateContent: "{}",
      validationRulesJson: "[]",
      structureJson: "{}",
      isActive: true,
      publishedBy: "user-1",
      publishedAt: new Date("2026-05-31T00:00:00.000Z"),
      title: "Wrong snapshot shape",
    });

    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request("/form-1/publish", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "公開用スナップショットの形式が不正です",
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("publishes when the active snapshot contains at least one question", async () => {
    mocks.getLatestSnapshot.mockResolvedValue({
      id: "snapshot-1",
      formId: "form-1",
      version: 1,
      plateContent: JSON.stringify([
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [{ text: "Question 1" }],
        },
      ]),
      validationRulesJson: "[]",
      structureJson: "{}",
      isActive: true,
      publishedBy: "user-1",
      publishedAt: new Date("2026-05-31T00:00:00.000Z"),
      title: "Valid snapshot",
    });

    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request("/form-1/publish", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "PUBLISHED",
      publishedAt: expect.any(Date),
    });
  });
});
