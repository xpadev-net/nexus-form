import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
  getFormStructureDiff: vi.fn(),
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
  getFormStructureDiff: mocks.getFormStructureDiff,
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

const currentStructure = {
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
  confirmation: {
    title: "Thanks",
    message: "Done",
    redirect_url: "https://example.com/after",
    show_response_summary: true,
    allow_edit_link: true,
  },
  notifications: {
    on_submit: {
      email: {
        enabled: false,
        recipients: [],
      },
      discord: {
        enabled: true,
        webhook_url: "https://discord.com/api/webhooks/123/discord-token",
        message_template: "old discord",
      },
      webhook: {
        enabled: true,
        url: "https://zapier.com/hooks/catch/current",
        secret: "current-secret-current-secret-123456",
        timeout_seconds: 30,
        retry_attempts: 3,
      },
    },
    on_duplicate_detected: {
      email: {
        enabled: true,
        recipients: ["audit@example.com"],
      },
      discord: {
        enabled: true,
        webhook_url: "https://discord.com/api/webhooks/123/duplicate-token",
      },
      webhook: {
        enabled: true,
        url: "https://pipedream.com/hooks/duplicate",
        secret: "duplicate-secret-duplicate-secret-123",
        timeout_seconds: 10,
        retry_attempts: 1,
      },
    },
  },
};

describe("forms structure post-submit settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.formAuthRoles.length = 0;
    mocks.getFormStructure.mockResolvedValue(currentStructure);
    mocks.getFormStructureDiff.mockResolvedValue({
      fromVersion: 1,
      toVersion: 2,
      changes: [],
      metadata: {
        memoryUsedMB: 1,
        calculationTime: 1,
      },
    });
    mocks.saveFormStructure.mockResolvedValue({
      id: "structure-4",
      formId: "form-1",
      version: 4,
      createdAt: new Date("2026-06-03T00:00:00.000Z"),
      changeLog: "Update post-submit settings",
      parentVersion: 3,
    });
  });

  it("masks notification webhook values in the structure response", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.structure.notifications.on_submit.discord).toEqual({
      enabled: true,
      has_webhook_url: true,
      message_template: "old discord",
    });
    expect(body.structure.notifications.on_submit.webhook).toEqual({
      enabled: true,
      has_url: true,
      has_secret: true,
      timeout_seconds: 30,
      retry_attempts: 3,
    });
    expect(JSON.stringify(body)).not.toContain("discord-token");
    expect(JSON.stringify(body)).not.toContain("duplicate-token");
    expect(JSON.stringify(body)).not.toContain("current-secret");
    expect(JSON.stringify(body)).not.toContain("duplicate-secret");
  });

  it("redacts notification and access-control secrets from structure diffs", async () => {
    mocks.getFormStructureDiff.mockResolvedValueOnce({
      fromVersion: 1,
      toVersion: 2,
      changes: [
        {
          type: "modified",
          path: "notifications",
          from: {
            on_submit: {
              discord: {
                enabled: true,
                webhook_url:
                  "https://discord.com/api/webhooks/123/old-discord-token",
              },
              webhook: {
                enabled: true,
                url: "https://zapier.com/hooks/catch/old",
                secret: "old-secret-old-secret-old-secret-123",
              },
            },
          },
          to: {
            on_submit: {
              discord: {
                enabled: true,
                webhook_url:
                  "https://discord.com/api/webhooks/123/new-discord-token",
              },
              webhook: {
                enabled: true,
                url: "https://zapier.com/hooks/catch/new",
                secret: "new-secret-new-secret-new-secret-123",
              },
            },
          },
        },
        {
          type: "modified",
          path: "access_control",
          from: {
            password_protection: {
              enabled: true,
              password: "$2b$10$old-password-hash",
            },
          },
          to: {
            password_protection: {
              enabled: true,
              password: "$2b$10$new-password-hash",
            },
          },
        },
      ],
      metadata: {
        memoryUsedMB: 1,
        calculationTime: 1,
      },
    });
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/diff?fromVersion=1&toVersion=2",
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("discord-token");
    expect(JSON.stringify(body)).not.toContain("zapier.com/hooks");
    expect(JSON.stringify(body)).not.toContain("old-secret");
    expect(JSON.stringify(body)).not.toContain("new-secret");
    expect(JSON.stringify(body)).not.toContain("$2b$10$");
    expect(JSON.stringify(body)).toContain("[redacted]");
  });

  it("updates only post-submit settings using the latest stored structure", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/post-submit",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: {
            title: "送信ありがとうございました",
            message: "担当者から連絡します。",
            supplemental_link: {
              label: "次のステップ",
              url: "https://example.com/next",
            },
            contact: {
              label: "サポート",
              email: "support@example.com",
              url: "https://example.com/support",
            },
          },
          notifications: {
            on_submit: {
              email: {
                enabled: true,
                recipients: ["owner@example.com"],
                subject: "新しい回答",
              },
              discord: {
                enabled: true,
                has_webhook_url: true,
                message_template: "new discord",
              },
              webhook: {
                enabled: true,
                has_url: true,
                has_secret: true,
                timeout_seconds: 45,
                retry_attempts: 2,
              },
            },
          },
        }),
      },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      structure: {
        id: "structure-4",
        formId: "form-1",
        version: 4,
        createdAt: "2026-06-03T00:00:00.000Z",
        changeLog: "Update post-submit settings",
        parentVersion: 3,
      },
    });
    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.getFormStructure).toHaveBeenCalledWith("form-1");
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        settings: currentStructure.settings,
        logic: currentStructure.logic,
        access_control: currentStructure.access_control,
        appearance: currentStructure.appearance,
        confirmation: {
          title: "送信ありがとうございました",
          message: "担当者から連絡します。",
          supplemental_link: {
            label: "次のステップ",
            url: "https://example.com/next",
          },
          contact: {
            label: "サポート",
            email: "support@example.com",
            url: "https://example.com/support",
          },
          redirect_url: "https://example.com/after",
          show_response_summary: true,
          allow_edit_link: true,
        },
        notifications: {
          on_submit: {
            email: {
              enabled: true,
              recipients: ["owner@example.com"],
              subject: "新しい回答",
            },
            discord: {
              enabled: true,
              webhook_url: "https://discord.com/api/webhooks/123/discord-token",
              message_template: "new discord",
            },
            webhook: {
              enabled: true,
              url: "https://zapier.com/hooks/catch/current",
              secret: "current-secret-current-secret-123456",
              timeout_seconds: 45,
              retry_attempts: 2,
            },
          },
          on_duplicate_detected:
            currentStructure.notifications.on_duplicate_detected,
        },
      }),
      "user-1",
      "Update post-submit settings",
    );
  });

  it("preserves omitted notification channels on partial post-submit PATCH", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/post-submit",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: {
            title: "Partial update",
            message: "Only email changes.",
          },
          notifications: {
            on_submit: {
              email: {
                enabled: true,
                recipients: ["partial@example.com"],
              },
            },
          },
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        confirmation: expect.objectContaining({
          title: "Partial update",
          message: "Only email changes.",
          redirect_url: "https://example.com/after",
          show_response_summary: true,
          allow_edit_link: true,
        }),
        notifications: expect.objectContaining({
          on_submit: {
            email: {
              enabled: true,
              recipients: ["partial@example.com"],
            },
            discord: currentStructure.notifications.on_submit.discord,
            webhook: currentStructure.notifications.on_submit.webhook,
          },
        }),
      }),
      "user-1",
      "Update post-submit settings",
    );
  });

  it("rejects invalid webhook URLs before saving", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request(
      "/form-1/structure/post-submit",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: {
            title: "Thanks",
            message: "Done",
          },
          notifications: {
            on_submit: {
              webhook: {
                enabled: true,
                url: "https://evil.example/webhook",
              },
            },
          },
        }),
      },
    );

    expect(res.status).toBe(400);
    expect(mocks.saveFormStructure).not.toHaveBeenCalled();
  });

  it("does not persist masked notification placeholders through full structure PUT", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 1,
      settings: { require_fingerprint: true },
      notifications: { on_submit: {} },
    });
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        structure: {
          version: 1,
          settings: { require_fingerprint: true },
          notifications: {
            on_submit: {
              discord: {
                enabled: true,
                has_webhook_url: true,
              },
              webhook: {
                enabled: true,
                has_url: true,
                has_secret: true,
              },
            },
            on_duplicate_detected: {
              discord: {
                enabled: true,
                has_webhook_url: true,
              },
              webhook: {
                enabled: true,
                has_url: true,
                has_secret: true,
              },
            },
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        notifications: {
          on_submit: {
            discord: {
              enabled: false,
              webhook_url: undefined,
            },
            webhook: {
              enabled: false,
              url: undefined,
              secret: undefined,
              timeout_seconds: 30,
              retry_attempts: 3,
            },
          },
          on_duplicate_detected: {
            discord: {
              enabled: false,
              webhook_url: undefined,
            },
            webhook: {
              enabled: false,
              url: undefined,
              secret: undefined,
              timeout_seconds: 30,
              retry_attempts: 3,
            },
          },
        },
      }),
      "user-1",
      undefined,
    );
  });

  it("restores duplicate notification secrets when only duplicate channels are masked", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 1,
      settings: { require_fingerprint: true },
      notifications: {
        on_submit: {},
        on_duplicate_detected:
          currentStructure.notifications.on_duplicate_detected,
      },
    });
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        structure: {
          version: 1,
          settings: { require_fingerprint: true },
          notifications: {
            on_submit: {},
            on_duplicate_detected: {
              discord: {
                enabled: true,
                has_webhook_url: true,
              },
              webhook: {
                enabled: true,
                has_url: true,
                has_secret: true,
                timeout_seconds: 20,
                retry_attempts: 2,
              },
            },
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.getFormStructure).toHaveBeenCalledWith("form-1");
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        notifications: {
          on_submit: {},
          on_duplicate_detected: {
            discord: {
              enabled: true,
              webhook_url:
                "https://discord.com/api/webhooks/123/duplicate-token",
            },
            webhook: {
              enabled: true,
              url: "https://pipedream.com/hooks/duplicate",
              secret: "duplicate-secret-duplicate-secret-123",
              timeout_seconds: 20,
              retry_attempts: 2,
            },
          },
        },
      }),
      "user-1",
      undefined,
    );
  });

  it("drops false notification mask flags before saving full structure PUT", async () => {
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        structure: {
          version: 1,
          settings: { require_fingerprint: true },
          notifications: {
            on_submit: {
              discord: {
                enabled: false,
                has_webhook_url: false,
              },
              webhook: {
                enabled: false,
                has_url: false,
                has_secret: false,
              },
            },
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.getFormStructure).not.toHaveBeenCalled();
    expect(mocks.saveFormStructure).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        notifications: {
          on_submit: {
            discord: {
              enabled: false,
              webhook_url: undefined,
            },
            webhook: {
              enabled: false,
              url: undefined,
              secret: undefined,
              timeout_seconds: 30,
              retry_attempts: 3,
            },
          },
        },
      }),
      "user-1",
      undefined,
    );
  });
});
