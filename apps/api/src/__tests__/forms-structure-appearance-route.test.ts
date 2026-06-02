import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
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

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
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

describe("PATCH /:id/structure/appearance", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.formAuthRoles.length = 0;
    mocks.getFormStructure.mockResolvedValue({
      version: 3,
      settings: {
        allow_edit_responses: true,
        require_fingerprint: true,
        response_limit: {
          enabled: true,
          max_responses: 100,
          message: "Full",
        },
      },
      logic: [
        {
          id: "rule-1",
          sourceBlockId: "question-1",
          condition: {
            field: "question-1",
            operator: "equals",
            value: "yes",
          },
          action: {
            type: "jump_to",
            targetBlockId: "section-2",
          },
          priority: 0,
          isActive: true,
        },
      ],
      access_control: {
        require_authentication: false,
        password_protection: {
          enabled: true,
          password: "$2b$10$stored-password-hash",
          password_hint: "pet name",
        },
      },
      appearance: {
        theme: {
          primary_color: "#2563eb",
          accent_color: "#16a34a",
          background_color: "#ffffff",
          font_family: "Inter",
        },
        layout: {
          width: "medium",
          alignment: "center",
          spacing: "comfortable",
          show_progress_bar: true,
          progress_position: "top",
          show_question_numbers: false,
        },
      },
    });
    mocks.saveFormStructure.mockResolvedValue({
      id: "structure-4",
      formId: "form-1",
      version: 4,
      createdAt: new Date("2026-06-03T00:00:00.000Z"),
      changeLog: "Update appearance settings",
      parentVersion: 3,
    });
  });

  it("updates only appearance using the latest stored structure", async () => {
    const nextAppearance = {
      theme: {
        primary_color: "#111111",
        accent_color: "#16a34a",
        background_color: "#ffffff",
        font_family: "Inter",
        brand_name: "Nexus Form",
      },
      layout: {
        width: "compact",
        alignment: "left",
        spacing: "spacious",
        show_progress_bar: true,
        progress_position: "top",
        show_question_numbers: true,
      },
    };
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/appearance",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appearance: nextAppearance }),
      },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      structure: {
        id: "structure-4",
        formId: "form-1",
        version: 4,
        createdAt: "2026-06-03T00:00:00.000Z",
        changeLog: "Update appearance settings",
        parentVersion: 3,
      },
    });
    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.getFormStructure).toHaveBeenCalledWith("form-1");
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        settings: {
          allow_edit_responses: true,
          require_fingerprint: true,
          response_limit: {
            enabled: true,
            max_responses: 100,
            message: "Full",
          },
        },
        logic: [
          {
            id: "rule-1",
            sourceBlockId: "question-1",
            condition: {
              field: "question-1",
              operator: "equals",
              value: "yes",
            },
            action: {
              type: "jump_to",
              targetBlockId: "section-2",
            },
            priority: 0,
            isActive: true,
          },
        ],
        access_control: {
          require_authentication: false,
          password_protection: {
            enabled: true,
            password: "$2b$10$stored-password-hash",
            password_hint: "pet name",
          },
        },
        appearance: nextAppearance,
      }),
      "user-1",
      "Update appearance settings",
    );
  });
});
