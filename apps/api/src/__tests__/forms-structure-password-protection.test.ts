import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
  getLatestSnapshot: vi.fn(),
  hashPassword: vi.fn(),
  saveFormStructure: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ): Promise<void> => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "user-1",
      });
      await next();
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
  getLatestSnapshot: mocks.getLatestSnapshot,
}));

vi.mock("../lib/security/password", () => ({
  hashPassword: mocks.hashPassword,
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

describe("forms structure password protection response", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getFormStructure.mockReset();
    mocks.getLatestSnapshot.mockReset();
    mocks.hashPassword.mockReset();
    mocks.saveFormStructure.mockReset();
  });

  it("masks the stored password hash and exposes only has_password to clients", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 1,
      settings: {},
      access_control: {
        require_authentication: false,
        password_protection: {
          enabled: true,
          password: "$2b$10$stored-password-hash",
          password_hint: "pet name",
        },
      },
    });
    mocks.getLatestSnapshot.mockResolvedValueOnce({
      structureJson: JSON.stringify({
        version: 1,
        settings: {},
        access_control: {
          require_authentication: false,
          password_protection: {
            enabled: false,
            password: "$2b$10$old-password-hash",
            password_hint: "old pet name",
          },
        },
      }),
    });
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.structure.access_control.password_protection).toEqual({
      enabled: true,
      has_password: true,
      password_hint: "pet name",
    });
    expect(
      body.structure.access_control.password_protection,
    ).not.toHaveProperty("password");
    expect(body.password_protection_publication).toEqual({
      current: {
        enabled: true,
        has_password: true,
        password_hint: "pet name",
      },
      published: {
        enabled: false,
        has_password: true,
        password_hint: "old pet name",
      },
      is_synced: false,
    });
    expect(JSON.stringify(body)).not.toContain("$2b$10$stored-password-hash");
    expect(JSON.stringify(body)).not.toContain("$2b$10$old-password-hash");
  });

  it("marks password protection as unpublished when only the stored password hash changed", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 2,
      settings: {},
      access_control: {
        require_authentication: false,
        password_protection: {
          enabled: true,
          password: "$2b$10$new-password-hash",
          password_hint: "pet name",
        },
      },
    });
    mocks.getLatestSnapshot.mockResolvedValueOnce({
      structureJson: JSON.stringify({
        version: 1,
        settings: {},
        access_control: {
          require_authentication: false,
          password_protection: {
            enabled: true,
            password: "$2b$10$old-password-hash",
            password_hint: "pet name",
          },
        },
      }),
    });
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.password_protection_publication).toEqual({
      current: {
        enabled: true,
        has_password: true,
        password_hint: "pet name",
      },
      published: {
        enabled: true,
        has_password: true,
        password_hint: "pet name",
      },
      is_synced: false,
    });
    expect(JSON.stringify(body)).not.toContain("$2b$10$new-password-hash");
    expect(JSON.stringify(body)).not.toContain("$2b$10$old-password-hash");
  });

  it("treats an unpublished default disabled password setting as synced", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 1,
      settings: {},
      access_control: {
        require_authentication: false,
        password_protection: {
          enabled: false,
        },
      },
    });
    mocks.getLatestSnapshot.mockResolvedValueOnce(null);
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.password_protection_publication).toEqual({
      current: {
        enabled: false,
        has_password: false,
      },
      published: null,
      is_synced: true,
    });
  });

  it("marks enabled password protection as unpublished when no snapshot exists", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 1,
      settings: {},
      access_control: {
        require_authentication: false,
        password_protection: {
          enabled: true,
          password: "$2b$10$stored-password-hash",
        },
      },
    });
    mocks.getLatestSnapshot.mockResolvedValueOnce(null);
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.password_protection_publication).toEqual({
      current: {
        enabled: true,
        has_password: true,
      },
      published: null,
      is_synced: false,
    });
    expect(JSON.stringify(body)).not.toContain("$2b$10$stored-password-hash");
  });

  it("still returns the masked structure when publication state lookup fails", async () => {
    mocks.getFormStructure.mockResolvedValueOnce({
      version: 2,
      settings: {},
      access_control: {
        require_authentication: false,
        password_protection: {
          enabled: true,
          password: "$2b$10$stored-password-hash",
          password_hint: "pet name",
        },
      },
    });
    mocks.getLatestSnapshot.mockRejectedValueOnce(
      new Error("snapshot database unavailable"),
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");

    const res = await formsStructureRouter.request("/form-1/structure");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("password_protection_publication");
    expect(body.structure.access_control.password_protection).toEqual({
      enabled: true,
      has_password: true,
      password_hint: "pet name",
    });
    expect(JSON.stringify(body)).not.toContain("$2b$10$stored-password-hash");
  });

  it("accepts the shared maximum when configuring password protection", async () => {
    const { MAX_PUBLIC_PASSWORD_LENGTH } = await import(
      "../lib/forms/password-protection"
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");
    const password = "x".repeat(MAX_PUBLIC_PASSWORD_LENGTH);
    mocks.getFormStructure.mockResolvedValue({
      version: 1,
      settings: {},
      access_control: { require_authentication: false },
    });
    mocks.hashPassword.mockResolvedValue("stored-password-hash");
    mocks.saveFormStructure.mockResolvedValue(undefined);

    const response = await formsStructureRouter.request(
      "/form-1/structure/access-control",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password_protection: {
            enabled: true,
            password,
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith(password);
    expect(mocks.saveFormStructure).toHaveBeenCalled();
  });

  it("rejects a password over the shared maximum before hashing", async () => {
    const { MAX_PUBLIC_PASSWORD_LENGTH } = await import(
      "../lib/forms/password-protection"
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");
    const password = "x".repeat(MAX_PUBLIC_PASSWORD_LENGTH + 1);

    const response = await formsStructureRouter.request(
      "/form-1/structure/access-control",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password_protection: {
            enabled: true,
            password,
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.saveFormStructure).not.toHaveBeenCalled();
  });

  it("accepts the shared maximum through the full structure contract", async () => {
    const { MAX_PUBLIC_PASSWORD_LENGTH } = await import(
      "../lib/forms/password-protection"
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");
    const password = "x".repeat(MAX_PUBLIC_PASSWORD_LENGTH);
    const savedVersion = {
      id: "version-1",
      formId: "form-1",
      version: 1,
      createdAt: new Date(),
      changeLog: null,
      parentVersion: null,
    };
    mocks.hashPassword.mockResolvedValue("stored-password-hash");
    mocks.saveFormStructure.mockResolvedValue(savedVersion);

    const response = await formsStructureRouter.request("/form-1/structure", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        structure: {
          version: 1,
          settings: {},
          access_control: {
            require_authentication: false,
            password_protection: { enabled: true, password },
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith(password);
    expect(mocks.saveFormStructure).toHaveBeenCalled();
    const savedStructure = mocks.saveFormStructure.mock.calls[0]?.[1];
    expect(savedStructure.access_control.password_protection.password).toBe(
      "stored-password-hash",
    );
  });

  it("rejects an over-limit password through the full structure contract", async () => {
    const { MAX_PUBLIC_PASSWORD_LENGTH } = await import(
      "../lib/forms/password-protection"
    );
    const { formsStructureRouter } = await import("../routes/forms-structure");
    const password = "x".repeat(MAX_PUBLIC_PASSWORD_LENGTH + 1);

    const response = await formsStructureRouter.request("/form-1/structure", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        structure: {
          version: 1,
          settings: {},
          access_control: {
            require_authentication: false,
            password_protection: { enabled: true, password },
          },
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.saveFormStructure).not.toHaveBeenCalled();
  });
});
