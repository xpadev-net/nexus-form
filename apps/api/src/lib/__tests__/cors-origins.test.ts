import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCorsOrigins,
  warnIfProductionCorsOriginsEmpty,
} from "../cors-origins";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.TRUSTED_ORIGINS;
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
});

describe("warnIfProductionCorsOriginsEmpty", () => {
  it("warns when production has no allowed CORS origins", () => {
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfProductionCorsOriginsEmpty([]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("TRUSTED_ORIGINS"),
    );
  });

  it("does not warn outside production", () => {
    process.env.NODE_ENV = "test";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfProductionCorsOriginsEmpty([]);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when production has allowed CORS origins", () => {
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfProductionCorsOriginsEmpty(["https://app.example.com"]);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
