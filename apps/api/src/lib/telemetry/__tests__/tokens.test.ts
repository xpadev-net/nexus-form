import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashIPAddress } from "../tokens";

vi.mock("@nexus-form/database", () => ({
  db: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  telemetryToken: {},
}));

const originalTelemetryIpSalt = process.env.TELEMETRY_IP_SALT;
const originalAuthSecret = process.env.AUTH_SECRET;

function setEnv(name: "TELEMETRY_IP_SALT" | "AUTH_SECRET", value?: string) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function expectedHash(ip: string, salt: string): string {
  return createHash("sha256")
    .update(ip + salt)
    .digest("hex");
}

function authSecretDerivedSalt(authSecret: string): string {
  return createHash("sha256")
    .update(`telemetry-ip-salt:${authSecret}`)
    .digest("hex");
}

afterEach(() => {
  setEnv("TELEMETRY_IP_SALT", originalTelemetryIpSalt);
  setEnv("AUTH_SECRET", originalAuthSecret);
});

describe("hashIPAddress", () => {
  it("uses TELEMETRY_IP_SALT when it is configured", () => {
    setEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    setEnv("AUTH_SECRET", "auth-secret");

    expect(hashIPAddress("203.0.113.10")).toBe(
      expectedHash("203.0.113.10", "telemetry-salt"),
    );
  });

  it("falls back to an AUTH_SECRET-derived salt when telemetry salt is absent", () => {
    setEnv("TELEMETRY_IP_SALT");
    setEnv("AUTH_SECRET", "auth-secret-a");

    expect(hashIPAddress("203.0.113.10")).toBe(
      expectedHash("203.0.113.10", authSecretDerivedSalt("auth-secret-a")),
    );
  });

  it("treats an empty TELEMETRY_IP_SALT as absent", () => {
    setEnv("TELEMETRY_IP_SALT", "");
    setEnv("AUTH_SECRET", "auth-secret-a");

    expect(hashIPAddress("203.0.113.10")).toBe(
      expectedHash("203.0.113.10", authSecretDerivedSalt("auth-secret-a")),
    );
  });

  it("uses different fallback salts for different AUTH_SECRET values", () => {
    setEnv("TELEMETRY_IP_SALT");
    setEnv("AUTH_SECRET", "auth-secret-a");
    const firstHash = hashIPAddress("203.0.113.10");

    setEnv("AUTH_SECRET", "auth-secret-b");

    expect(hashIPAddress("203.0.113.10")).not.toBe(firstHash);
  });

  it("does not fall back to a fixed development salt", () => {
    setEnv("TELEMETRY_IP_SALT");
    setEnv("AUTH_SECRET", "auth-secret");

    expect(hashIPAddress("203.0.113.10")).not.toBe(
      expectedHash("203.0.113.10", "default-salt-change-in-production"),
    );
  });

  it("requires TELEMETRY_IP_SALT or AUTH_SECRET", () => {
    setEnv("TELEMETRY_IP_SALT");
    setEnv("AUTH_SECRET");

    expect(() => hashIPAddress("203.0.113.10")).toThrow(
      "TELEMETRY_IP_SALT or AUTH_SECRET must be set for telemetry IP hashing",
    );
  });
});
