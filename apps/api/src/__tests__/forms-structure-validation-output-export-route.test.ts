import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
  getValidationOutputExportSettings: vi.fn(),
  saveFormStructure: vi.fn(),
  formAuthRoles: [] as Array<unknown>,
}));

vi.mock("../load-env", () => ({}));

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
  getFormStructureDiff: vi.fn(),
  getFormStructureHistory: vi.fn(),
  restoreFormStructure: vi.fn(),
  saveFormStructure: mocks.saveFormStructure,
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
}));

vi.mock("../lib/forms/validation-output-export-settings", () => ({
  getValidationOutputExportSettings: mocks.getValidationOutputExportSettings,
}));

vi.mock("../lib/security/password", () => ({
  hashPassword: vi.fn(),
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

const currentStructure = {
  version: 2,
  settings: {
    allow_edit_responses: true,
    require_fingerprint: true,
    privacy_notice: "keep me",
  },
  confirmation: {
    title: "Thanks",
    message: "Done",
  },
};

describe("forms structure validation output export settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.formAuthRoles.length = 0;
    mocks.getFormStructure.mockResolvedValue(currentStructure);
    mocks.getValidationOutputExportSettings.mockResolvedValue({
      settings: {
        values: [
          {
            rule_id: "rule-1",
            provider_name: "github",
            rule_type: "user_exists",
            output_key: "username",
            enabled: false,
          },
        ],
      },
      values: [
        {
          rule_id: "rule-1",
          rule_name: "GitHub account",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          label: "GitHub username",
          enabled: false,
          source: "builtin",
        },
        {
          rule_id: "deleted-rule",
          rule_name: "deleted-rule",
          provider_name: "unknown",
          rule_type: "unknown",
          output_key: "legacy_score",
          label: "Legacy Score",
          enabled: true,
          source: "result",
        },
      ],
    });
    mocks.saveFormStructure.mockResolvedValue({
      id: "structure-3",
      formId: "form-1",
      version: 3,
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      changeLog: "Update validation output export settings",
      parentVersion: 2,
    });
  });

  it("loads zod-validated discovered validation output export settings", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/validation-output-export",
    );

    expect(res.status).toBe(200);
    expect(mocks.formAuthRoles).toContain("VIEWER");
    await expect(res.json()).resolves.toMatchObject({
      settings: {
        values: [
          {
            rule_id: "rule-1",
            output_key: "username",
            enabled: false,
          },
        ],
      },
      values: [
        {
          rule_name: "GitHub account",
          output_key: "username",
          enabled: false,
        },
        {
          rule_id: "deleted-rule",
          output_key: "legacy_score",
          source: "result",
        },
      ],
    });
  });

  it("returns 404 when validation output export settings cannot find the form structure", async () => {
    const { FormStructureNotFoundError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.getValidationOutputExportSettings.mockRejectedValueOnce(
      new FormStructureNotFoundError("form-1"),
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/validation-output-export",
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Form structure not found",
    });
    expect(mocks.saveFormStructure).not.toHaveBeenCalled();
  });

  it("saves only validation output export settings on the current structure", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/validation-output-export",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: [
            {
              rule_id: "rule-1",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "username",
              enabled: false,
            },
            {
              rule_id: "rule-1",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "followers",
              enabled: true,
            },
          ],
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.getFormStructure).toHaveBeenCalledWith("form-1");
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        settings: {
          ...currentStructure.settings,
          validation_output_export: {
            values: [
              {
                rule_id: "rule-1",
                provider_name: "github",
                rule_type: "user_exists",
                output_key: "username",
                enabled: false,
              },
              {
                rule_id: "rule-1",
                provider_name: "github",
                rule_type: "user_exists",
                output_key: "followers",
                enabled: true,
              },
            ],
          },
        },
      }),
      "user-1",
      "Update validation output export settings",
    );
  });

  it("returns 404 without saving when the current structure is missing during validation output export PATCH", async () => {
    const { FormStructureNotFoundError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.getFormStructure.mockRejectedValueOnce(
      new FormStructureNotFoundError("form-1"),
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/validation-output-export",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: [
            {
              rule_id: "rule-1",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "username",
              enabled: false,
            },
          ],
        }),
      },
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Form structure not found",
    });
    expect(mocks.saveFormStructure).not.toHaveBeenCalled();
  });

  it("rejects duplicate output-key settings before saving", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/validation-output-export",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: [
            {
              rule_id: "rule-1",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "username",
              enabled: true,
            },
            {
              rule_id: "rule-1",
              provider_name: "github",
              rule_type: "user_exists",
              output_key: "username",
              enabled: false,
            },
          ],
        }),
      },
    );

    expect(res.status).toBe(400);
    expect(mocks.saveFormStructure).not.toHaveBeenCalled();
  });
});
