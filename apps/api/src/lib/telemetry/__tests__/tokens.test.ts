import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeTokensOrThrow,
  findTelemetryTokens,
  hashIPAddress,
} from "../tokens";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
    update: vi.fn(),
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ type: "gt", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    type: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  selectFrom: vi.fn(),
  selectWhere: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => ({
  telemetryToken: {
    expiresAt: "telemetryToken.expiresAt",
    ip: "telemetryToken.ip",
    token: "telemetryToken.token",
    usedAt: "telemetryToken.usedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  gt: mocks.gt,
  inArray: mocks.inArray,
  isNull: mocks.isNull,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.select.mockReturnValue({ from: mocks.selectFrom });
  mocks.selectFrom.mockReturnValue({ where: mocks.selectWhere });
  mocks.selectWhere.mockResolvedValue([{ token: "token-a" }]);
  mocks.db.update.mockReturnValue({ set: mocks.updateSet });
  mocks.db.transaction.mockImplementation(async (callback) => {
    return callback(mocks.db);
  });
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

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

describe("consumeTokensOrThrow", () => {
  it("accepts multiple submitted tokens when at least one current IP hash matches and consumes submitted live candidates", async () => {
    setEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);

    await consumeTokensOrThrow(
      ["token-a", "token-a", "token-b"],
      "203.0.113.10",
    );

    expect(mocks.inArray).toHaveBeenCalledWith("telemetryToken.token", [
      "token-a",
      "token-b",
    ]);
    expect(mocks.eq).toHaveBeenCalledWith(
      "telemetryToken.ip",
      expectedHash("203.0.113.10", "telemetry-salt"),
    );
    const ipCondition = mocks.eq.mock.results[0]?.value;
    expect(mocks.and).toHaveBeenCalledWith(
      expect.anything(),
      ipCondition,
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.updateWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([ipCondition]),
      }),
    );
    expect(mocks.updateWhere).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        args: expect.not.arrayContaining([ipCondition]),
      }),
    );
    expect(mocks.updateSet).toHaveBeenCalledWith({
      usedAt: expect.any(Date),
    });
  });

  it("accepts when all submitted tokens match the current IP hash", async () => {
    setEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 2 }]);

    await expect(
      consumeTokensOrThrow(["token-a", "token-b"], "203.0.113.10"),
    ).resolves.toBeUndefined();

    const ipCondition = mocks.eq.mock.results[0]?.value;
    expect(mocks.updateWhere).toHaveBeenCalledTimes(2);
    expect(mocks.updateWhere.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining([ipCondition]),
      }),
    );
    expect(mocks.updateWhere.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        args: expect.not.arrayContaining([ipCondition]),
      }),
    );
  });

  it("rejects tokens when no row matches the current IP hash", async () => {
    setEnv("TELEMETRY_IP_SALT", "telemetry-salt");
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 0 }]);

    await expect(
      consumeTokensOrThrow(["token-a"], "198.51.100.23"),
    ).rejects.toThrow("Invalid, expired, or IP-mismatched telemetry tokens");
  });
});

describe("findTelemetryTokens", () => {
  it("finds only unused tokens that match the current IP hash", async () => {
    setEnv("TELEMETRY_IP_SALT", "telemetry-salt");

    await expect(
      findTelemetryTokens(["token-a"], "203.0.113.10"),
    ).resolves.toEqual([{ token: "token-a" }]);

    expect(mocks.inArray).toHaveBeenCalledWith("telemetryToken.token", [
      "token-a",
    ]);
    expect(mocks.eq).toHaveBeenCalledWith(
      "telemetryToken.ip",
      expectedHash("203.0.113.10", "telemetry-salt"),
    );
    const ipCondition = mocks.eq.mock.results[0]?.value;
    expect(mocks.selectWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([ipCondition]),
      }),
    );
  });
});
