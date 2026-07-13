import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  getLatestSnapshot: vi.fn(),
  pendingUpdate: undefined as Record<string, unknown> | undefined,
  routeState: {
    generation: 9_007_199_254_740_993n,
    status: "DRAFT",
  },
  sql: vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => ({
    op: "sql",
    params,
    strings: Array.from(strings),
  })),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    update: vi.fn(() => ({
      set: mocks.updateSet,
    })),
  },
  form: {
    id: "form.id",
    publicPasswordGrantGeneration: "form.publicPasswordGrantGeneration",
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

vi.mock("drizzle-orm/sql", () => ({ sql: mocks.sql }));

const INITIAL_GENERATION = 9_007_199_254_740_993n;

function generationIncrementSql() {
  return {
    op: "sql",
    params: ["form.publicPasswordGrantGeneration"],
    strings: ["", " + 1"],
  };
}

function statusNotEqualSql(status: "PUBLISHED" | "UNPUBLISHED") {
  return {
    op: "sql",
    params: ["form.status", status],
    strings: ["", " <> ", ""],
  };
}

describe("POST /:id/publish", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.pendingUpdate = undefined;
    mocks.routeState.generation = INITIAL_GENERATION;
    mocks.routeState.status = "DRAFT";
    mocks.updateSet.mockImplementation((values: Record<string, unknown>) => {
      mocks.pendingUpdate = values;
      return { where: mocks.updateWhere };
    });
    mocks.updateWhere.mockImplementation(async (condition) => {
      const statusCondition = condition.conditions[1];
      const nextStatus = statusCondition.params[1] as
        | "PUBLISHED"
        | "UNPUBLISHED";
      if (mocks.routeState.status === nextStatus) {
        return [{ affectedRows: 0 }];
      }

      const update = mocks.pendingUpdate;
      if (!update) throw new Error("Missing pending form update");
      expect(update.publicPasswordGrantGeneration).toEqual(
        generationIncrementSql(),
      );
      mocks.routeState.generation += 1n;
      mocks.routeState.status = nextStatus;
      return [{ affectedRows: 1 }];
    });
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

  it("returns 400 without publishing when the active snapshot JSON is not an array and is treated as no questions", async () => {
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
      error: "質問がありません。質問を追加してから公開してください",
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("publishes when the active snapshot contains at least one question", async () => {
    mocks.routeState.status = "UNPUBLISHED";
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
    expect(mocks.routeState).toEqual({
      generation: INITIAL_GENERATION + 1n,
      status: "PUBLISHED",
    });

    const retryResponse = await formsDetailRouter.request("/form-1/publish", {
      method: "POST",
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual({ ok: true });
    expect(mocks.routeState).toEqual({
      generation: INITIAL_GENERATION + 1n,
      status: "PUBLISHED",
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PUBLISHED",
        publishedAt: expect.any(Date),
        publicPasswordGrantGeneration: generationIncrementSql(),
      }),
    );
    expect(mocks.updateSet).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere).toHaveBeenNthCalledWith(1, {
      op: "and",
      conditions: [
        { op: "eq", left: "form.id", right: "form-1" },
        statusNotEqualSql("PUBLISHED"),
      ],
    });
    expect(mocks.updateWhere).toHaveBeenNthCalledWith(2, {
      op: "and",
      conditions: [
        { op: "eq", left: "form.id", right: "form-1" },
        statusNotEqualSql("PUBLISHED"),
      ],
    });
  });

  it("unpublishes through the authoritative lifecycle transaction", async () => {
    mocks.routeState.status = "PUBLISHED";
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request("/form-1/unpublish", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.routeState).toEqual({
      generation: INITIAL_GENERATION + 1n,
      status: "UNPUBLISHED",
    });

    const retryResponse = await formsDetailRouter.request("/form-1/unpublish", {
      method: "POST",
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual({ ok: true });
    expect(mocks.routeState).toEqual({
      generation: INITIAL_GENERATION + 1n,
      status: "UNPUBLISHED",
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "UNPUBLISHED",
        publicPasswordGrantGeneration: generationIncrementSql(),
      }),
    );
    expect(mocks.updateSet).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere).toHaveBeenNthCalledWith(1, {
      op: "and",
      conditions: [
        { op: "eq", left: "form.id", right: "form-1" },
        statusNotEqualSql("UNPUBLISHED"),
      ],
    });
    expect(mocks.updateWhere).toHaveBeenNthCalledWith(2, {
      op: "and",
      conditions: [
        { op: "eq", left: "form.id", right: "form-1" },
        statusNotEqualSql("UNPUBLISHED"),
      ],
    });
  });
});
