import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
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
    expect(JSON.stringify(body)).not.toContain("$2b$10$stored-password-hash");
  });
});
