import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTwitterBaseUrlConfig,
  getTwitterConfig,
  validateTwitterConfig,
} from "../config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTwitterConfig", () => {
  it("rejects Twitter base URLs outside the allowed host list", () => {
    vi.stubEnv("TWITTER_BEARER_TOKEN", "token");
    vi.stubEnv("TWITTER_BASE_URL", "https://internal.example.test");

    expect(() => getTwitterConfig()).toThrow(
      "Twitter base URL host must be one of: api.twitter.com",
    );
  });

  it("accepts the default Twitter API host", () => {
    vi.stubEnv("TWITTER_BEARER_TOKEN", "token");
    vi.stubEnv("TWITTER_BASE_URL", "https://api.twitter.com");

    expect(getTwitterConfig()).toMatchObject({
      bearerToken: "token",
      baseUrl: "https://api.twitter.com",
    });
  });
});

describe("validateTwitterConfig", () => {
  it("allows explicit hosts only when passed in config", () => {
    expect(
      validateTwitterConfig({
        bearerToken: "token",
        baseUrl: "https://api.twitter.test",
        allowedBaseUrlHosts: ["api.twitter.test"],
      }),
    ).toEqual({ isValid: true, errors: [] });
  });

  it("rejects malformed Twitter base URLs", () => {
    expect(
      validateTwitterConfig({
        bearerToken: "token",
        baseUrl: "not-a-url",
      }).errors,
    ).toContain("Twitter base URL must be a valid URL");
  });

  it("rejects non-HTTPS Twitter base URLs", () => {
    expect(
      validateTwitterConfig({
        bearerToken: "token",
        baseUrl: "http://api.twitter.com",
      }).errors,
    ).toContain("Twitter base URL must use HTTPS");
  });
});

describe("assertTwitterBaseUrlConfig", () => {
  it("normalizes accepted Twitter base URLs", () => {
    expect(assertTwitterBaseUrlConfig("https://api.twitter.com/")).toBe(
      "https://api.twitter.com",
    );
  });

  it("rejects allow-list mismatched base URLs without requiring credentials", () => {
    expect(() =>
      assertTwitterBaseUrlConfig("https://internal.example.test"),
    ).toThrow("Twitter base URL host must be one of: api.twitter.com");
  });
});
