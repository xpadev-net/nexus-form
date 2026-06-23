import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calculateFormDiff: vi.fn(),
  checkUnpublishedChanges: vi.fn(),
  getFormStructure: vi.fn(),
  getLatestSnapshot: vi.fn(),
  publishSnapshot: vi.fn(),
  restoreFromSnapshot: vi.fn(),
  saveFormStructure: vi.fn(),
  order: [] as string[],
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  formSnapshot: {
    id: "formSnapshot.id",
    formId: "formSnapshot.formId",
    version: "formSnapshot.version",
    isActive: "formSnapshot.isActive",
    publishedBy: "formSnapshot.publishedBy",
    publishedAt: "formSnapshot.publishedAt",
    changeLog: "formSnapshot.changeLog",
    title: "formSnapshot.title",
    description: "formSnapshot.description",
    parentVersion: "formSnapshot.parentVersion",
    plateContent: "formSnapshot.plateContent",
    validationRulesJson: "formSnapshot.validationRulesJson",
    structureJson: "formSnapshot.structureJson",
  },
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
  createRateLimit: () => {
    return async (_c: unknown, next: () => Promise<void>) => next();
  },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  activateSnapshot: vi.fn(),
  calculateFormDiff: mocks.calculateFormDiff,
  checkUnpublishedChanges: mocks.checkUnpublishedChanges,
  getLatestSnapshot: mocks.getLatestSnapshot,
  getLatestSnapshotByVersion: vi.fn(),
  publishSnapshot: mocks.publishSnapshot,
  restoreFromSnapshot: mocks.restoreFromSnapshot,
  restoreFromSnapshotVersion: vi.fn(),
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: mocks.getFormStructure,
  getFormStructureDiff: vi.fn(),
  getFormStructureHistory: vi.fn(),
  restoreFormStructure: vi.fn(),
  saveFormStructure: mocks.saveFormStructure,
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  ValidationRuleConfigError: class ValidationRuleConfigError extends Error {},
}));

vi.mock("../lib/security/password", () => ({
  hashPassword: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  count: vi.fn(() => ({ type: "count" })),
  desc: vi.fn((column: unknown) => ({ type: "desc", column })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
}));

function createDeferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const structurePayload = {
  structure: {
    settings: {
      allow_edit_responses: false,
    },
  },
};

const currentStructure = {
  settings: {
    allow_edit_responses: false,
  },
};

const savedStructure = {
  id: "structure-2",
  formId: "form-1",
  version: 2,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  changeLog: "Update structure",
  parentVersion: 1,
};

describe("forms snapshots reset structure mutation locking", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.getLatestSnapshot.mockResolvedValue(null);
    mocks.calculateFormDiff.mockResolvedValue({
      formId: "form-1",
      hasUnpublishedChanges: false,
      hasChangesFromActive: false,
      hasValidationRuleChanges: false,
      nodes: [],
      totalChanges: 0,
      lastChecked: new Date("2026-06-01T00:00:00.000Z"),
    });
    mocks.checkUnpublishedChanges.mockResolvedValue({
      hasChanges: false,
      hasValidationRuleChanges: false,
      lastPublishedAt: null,
    });
  });

  it("serializes snapshot reset and structure update through the same form lock", async () => {
    const resetStarted = createDeferred();
    const releaseReset = createDeferred();
    mocks.restoreFromSnapshot.mockImplementation(async () => {
      mocks.order.push("reset-start");
      resetStarted.resolve();
      await releaseReset.promise;
      mocks.order.push("reset-end");
      return { plateContent: "[]" };
    });
    mocks.getFormStructure.mockImplementation(async () => {
      mocks.order.push("update-start");
      return currentStructure;
    });
    mocks.saveFormStructure.mockImplementation(async () => {
      mocks.order.push("update-save");
      return savedStructure;
    });

    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const resetPromise = formsSnapshotsRouter.request(
      "/form-1/snapshots/reset",
      {
        method: "POST",
      },
    );
    await resetStarted.promise;

    const updatePromise = formsStructureRouter.request("/form-1/structure", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(structurePayload),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.order).toEqual(["reset-start"]);

    releaseReset.resolve();
    const [resetRes, updateRes] = await Promise.all([
      resetPromise,
      updatePromise,
    ]);

    expect(resetRes.status).toBe(200);
    expect(updateRes.status).toBe(200);
    expect(mocks.order).toEqual(["reset-start", "reset-end", "update-save"]);
  });

  it("maps structure mutation uniqueness conflicts during reset to 409", async () => {
    mocks.restoreFromSnapshot.mockRejectedValue(
      Object.assign(
        new Error(
          "Duplicate entry 'form-1' for key 'FormStructure_activeFormId_key'",
        ),
        { code: "ER_DUP_ENTRY", errno: 1062 },
      ),
    );
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const res = await formsSnapshotsRouter.request("/form-1/snapshots/reset", {
      method: "POST",
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Form structure changed concurrently; retry the request",
    });
  });
});
