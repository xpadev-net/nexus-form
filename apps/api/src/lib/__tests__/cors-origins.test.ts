import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertProductionCorsOriginsConfigured,
  getCorsOrigins,
} from "../cors-origins";

const originalNodeEnv = process.env.NODE_ENV;
const originalTrustedOrigins = process.env.TRUSTED_ORIGINS;

function getProcessErrorOutput(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if ("stderr" in error) {
    if (typeof error.stderr === "string") return error.stderr;
    if (error.stderr instanceof Buffer) return error.stderr.toString();
  }
  return error.message;
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalTrustedOrigins === undefined) {
    delete process.env.TRUSTED_ORIGINS;
  } else {
    process.env.TRUSTED_ORIGINS = originalTrustedOrigins;
  }
  vi.restoreAllMocks();
});

describe("getCorsOrigins", () => {
  it("includes localhost in development and test and trims trusted origins", () => {
    for (const env of ["development", "test"] as const) {
      process.env.NODE_ENV = env;
      process.env.TRUSTED_ORIGINS =
        " https://example.com,https://example.com, ,https://app.example.com ";

      expect(getCorsOrigins()).toEqual([
        "http://localhost:3000",
        "https://example.com",
        "https://app.example.com",
      ]);
    }
  });

  it("normalizes valid HTTP(S) origins", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_ORIGINS =
      " HTTPS://APP.EXAMPLE.COM:443/,https://app.example.com ";

    expect(getCorsOrigins()).toEqual(["https://app.example.com"]);
  });

  it("does not include localhost in production", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_ORIGINS = "https://app.example.com";

    expect(getCorsOrigins()).toEqual(["https://app.example.com"]);
  });

  it("does not include localhost for unspecified runtime environments", () => {
    process.env.NODE_ENV = "staging";
    process.env.TRUSTED_ORIGINS = "https://staging.example.com";

    expect(getCorsOrigins()).toEqual(["https://staging.example.com"]);
  });

  it.each([
    "development",
    "test",
  ] as const)("keeps localhost as the default in %s", (env) => {
    process.env.NODE_ENV = env;
    delete process.env.TRUSTED_ORIGINS;

    expect(getCorsOrigins()).toEqual(["http://localhost:3000"]);
  });
});

describe("assertProductionCorsOriginsConfigured", () => {
  it.each([
    [undefined, "missing"],
    ["", "empty"],
    [" , ", "empty entries"],
    ["not-a-url", "malformed URL"],
    ["ftp://example.com", "non-HTTP(S) URL"],
    ["https://*.example.com", "wildcard hostname"],
    ["https://example.com/path", "path-bearing URL"],
  ])("rejects production TRUSTED_ORIGINS with %s", (trustedOrigins, _description) => {
    process.env.NODE_ENV = "production";
    if (trustedOrigins === undefined) {
      delete process.env.TRUSTED_ORIGINS;
    } else {
      process.env.TRUSTED_ORIGINS = trustedOrigins;
    }

    expect(() => assertProductionCorsOriginsConfigured()).toThrow(
      "TRUSTED_ORIGINS must contain one or more valid HTTP(S) origins in production",
    );
  });

  it("accepts a non-empty set of normalized production origins", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_ORIGINS = "https://app.example.com/";

    expect(() => assertProductionCorsOriginsConfigured()).not.toThrow();
  });

  it("rejects production when valid and invalid origins are mixed", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_ORIGINS = "https://app.example.com,not-an-origin";

    expect(() => assertProductionCorsOriginsConfigured()).toThrow(
      "TRUSTED_ORIGINS must contain one or more valid HTTP(S) origins in production",
    );
  });

  it("does not enforce production configuration outside production", () => {
    process.env.NODE_ENV = "test";
    delete process.env.TRUSTED_ORIGINS;

    expect(() => assertProductionCorsOriginsConfigured()).not.toThrow();
  });

  // Import without entrypoint semantics to cover adapter-based serving paths.
  it.each([
    [undefined, "missing"],
    ["https://*.example.com", "invalid wildcard hostname"],
  ])("rejects production index module import with %s TRUSTED_ORIGINS", async (trustedOrigins, _description) => {
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "test-auth-secret-test-auth-secret",
      BETTER_AUTH_URL: "http://localhost:3001",
      DATABASE_URL: "mysql://user:pass@localhost:3306/db",
      S3_BUCKET_TMP: "tmp-bucket",
      S3_BUCKET_PROD: "prod-bucket",
    };
    if (trustedOrigins === undefined) {
      delete childEnvironment.TRUSTED_ORIGINS;
    } else {
      childEnvironment.TRUSTED_ORIGINS = trustedOrigins;
    }

    let errorOutput = "";
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          "await import('./src/index.ts')",
        ],
        {
          cwd: process.cwd(),
          env: childEnvironment,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      errorOutput = getProcessErrorOutput(error);
    }

    expect(errorOutput).toContain(
      "TRUSTED_ORIGINS must contain one or more valid HTTP(S) origins in production",
    );
  });
});
