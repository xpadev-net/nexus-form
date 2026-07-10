import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertProductionCorsOriginsConfigured,
  getCorsOrigins,
} from "../cors-origins";

const originalNodeEnv = process.env.NODE_ENV;
const originalTrustedOrigins = process.env.TRUSTED_ORIGINS;

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
});
