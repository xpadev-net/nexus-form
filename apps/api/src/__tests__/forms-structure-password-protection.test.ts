import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
  getLatestSnapshot: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> => {
      await next();
    },
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: mocks.getFormStructure,
  getFormStructureDiff: vi.fn(),
  getFormStructureHistory: vi.fn(),
  restoreFormStructure: vi.fn(),
  saveFormStructure: vi.fn(),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: mocks.getLatestSnapshot,
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

describe("forms structure password protection response", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getFormStructure.mockReset();
    mocks.getLatestSnapshot.mockReset();
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
});
