import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: mocks.insert,
  },
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

describe("telemetryRouter development bypass", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
  });

  it("issues a development token without a client IP when form security bypass is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "true");
    const { telemetryRouter } = await import("./telemetry");

    const response = await telemetryRouter.request("/v4", { method: "POST" });

    await expect(response.json()).resolves.toEqual({
      success: true,
      token: "form-security-dev-bypass-v4",
      version: "v4",
    });
  });

  it("returns a development token without persisting when a client IP is available", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "true");
    const { telemetryRouter } = await import("./telemetry");

    const response = await telemetryRouter.request("/v4", {
      method: "POST",
      headers: {
        "x-nginx-forwarded-for": "203.0.113.10",
      },
    });

    await expect(response.json()).resolves.toEqual({
      success: true,
      token: "form-security-dev-bypass-v4",
      version: "v4",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a spoofed telemetry header when no trusted proxy is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    const { telemetryRouter } = await import("./telemetry");

    const response = await telemetryRouter.request("/v4", {
      method: "POST",
      headers: {
        "x-nginx-forwarded-for": "203.0.113.10",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "IP_DETECTION_FAILED",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a telemetry header outside the trusted proxy count boundary", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "2");
    const { telemetryRouter } = await import("./telemetry");

    const response = await telemetryRouter.request("/v4", {
      method: "POST",
      headers: {
        "x-nginx-forwarded-for": "203.0.113.10",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "IP_DETECTION_FAILED",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("persists only the trusted telemetry IP hash from the configured boundary", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "2");
    const expectedIpHash = createHash("sha256")
      .update("203.0.113.10telemetry-salt")
      .digest("hex");
    const { telemetryRouter } = await import("./telemetry");

    const response = await telemetryRouter.request("/v4", {
      method: "POST",
      headers: {
        "x-nginx-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      version: "v4",
      token: expect.any(String),
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: expectedIpHash,
        version: "V4",
      }),
    );
  });

  it("still rejects missing client IP outside the development bypass", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "true");
    const { telemetryRouter } = await import("./telemetry");

    const response = await telemetryRouter.request("/v4", { method: "POST" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "IP_DETECTION_FAILED",
    });
  });
});
