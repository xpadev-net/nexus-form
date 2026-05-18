import { form } from "@nexus-form/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  formUpdateSet: vi.fn(),
  insertValues: vi.fn(),
  structureUpdateSet: vi.fn(),
  where: vi.fn(),
  getFormStructure: vi.fn(),
  formAuthRoles: [] as Array<unknown>,
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  form: {
    id: "form.id",
    allowEditResponses: "form.allowEditResponses",
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
  formStructure: {
    formId: "formStructure.formId",
    isActive: "formStructure.isActive",
    version: "formStructure.version",
  },
  formValidationRule: {},
  formValidationRuleBlock: {},
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: (requiredRole?: unknown) => {
    mocks.formAuthRoles.push(requiredRole);
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
  getFormStructure: mocks.getFormStructure,
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

describe("PATCH /:id/settings/responses", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.formAuthRoles.length = 0;
    mocks.where.mockResolvedValue(undefined);
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ version: 2 }]),
      })),
      update: vi.fn((table: unknown) => ({
        set:
          table === form
            ? mocks.formUpdateSet.mockReturnValue({ where: mocks.where })
            : mocks.structureUpdateSet.mockReturnValue({ where: mocks.where }),
      })),
      insert: vi.fn(() => ({
        values: mocks.insertValues.mockResolvedValue(undefined),
      })),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
  });

  it("requires editor access and saves response settings through the shared structure contract", async () => {
    mocks.getFormStructure.mockResolvedValue({
      version: 2,
      settings: {
        allow_edit_responses: false,
        response_limit: {
          enabled: true,
          max_responses: 25,
          message: "Full",
        },
      },
    });
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const res = await formsDetailRouter.request("/form-1/settings/responses", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowEdit: true,
        maxResponses: 100,
        requireFingerprint: true,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.formUpdateSet).toHaveBeenCalledWith({
      allowEditResponses: true,
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        version: 3,
        createdBy: "user-1",
        changeLog: "Update response settings",
        parentVersion: 2,
      }),
    );
    const inserted = mocks.insertValues.mock.calls[0]?.[0] as
      | { structureJson: string }
      | undefined;
    expect(inserted).toBeDefined();
    expect(JSON.parse(inserted?.structureJson ?? "{}")).toEqual({
      version: 2,
      settings: {
        allow_edit_responses: true,
        require_fingerprint: true,
        response_limit: {
          enabled: true,
          max_responses: 100,
          message: "Full",
        },
      },
    });
  });

  it("persists require_fingerprint false when fingerprint collection is disabled", async () => {
    mocks.getFormStructure.mockResolvedValue({
      version: 2,
      settings: {
        allow_edit_responses: true,
      },
    });
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const res = await formsDetailRouter.request("/form-1/settings/responses", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowEdit: true,
        maxResponses: null,
        requireFingerprint: false,
      }),
    });

    expect(res.status).toBe(200);
    const inserted = mocks.insertValues.mock.calls[0]?.[0] as
      | { structureJson: string }
      | undefined;
    expect(JSON.parse(inserted?.structureJson ?? "{}")).toEqual({
      version: 2,
      settings: {
        allow_edit_responses: true,
        require_fingerprint: false,
      },
    });
  });

  it("removes the response limit when the payload requests unlimited responses", async () => {
    mocks.getFormStructure.mockResolvedValue({
      version: 2,
      settings: {
        allow_edit_responses: true,
        response_limit: {
          enabled: true,
          max_responses: 25,
        },
      },
    });
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const res = await formsDetailRouter.request("/form-1/settings/responses", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowEdit: false,
        maxResponses: 0,
        requireFingerprint: true,
      }),
    });

    expect(res.status).toBe(200);
    const inserted = mocks.insertValues.mock.calls[0]?.[0] as
      | { structureJson: string }
      | undefined;
    expect(JSON.parse(inserted?.structureJson ?? "{}")).toEqual({
      version: 2,
      settings: {
        allow_edit_responses: false,
        require_fingerprint: true,
      },
    });
  });
});
