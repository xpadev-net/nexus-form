import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GITHUB_CONFIG_DEFAULTS,
  getGitHubApiTimeoutMs,
  getGitHubConfig,
  MAX_TIMER_MS,
  validateGitHubConfig,
} from "../config";

afterEach(() => {
  delete process.env.GITHUB_API_TIMEOUT_MS;
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_PRIVATE_KEY;
  delete process.env.GITHUB_INSTALLATION_ID;
  delete process.env.GITHUB_CACHE_EXPIRY;
  vi.restoreAllMocks();
});

describe("GitHub API timeout config", () => {
  it("uses GITHUB_API_TIMEOUT_MS when it is a positive integer", () => {
    process.env.GITHUB_API_TIMEOUT_MS = "2500";

    expect(getGitHubApiTimeoutMs()).toBe(2500);
  });

  it("falls back to the default timeout for invalid values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GITHUB_API_TIMEOUT_MS = "invalid";

    expect(getGitHubApiTimeoutMs()).toBe(GITHUB_CONFIG_DEFAULTS.API_TIMEOUT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_API_TIMEOUT_MS"),
    );
  });

  it("falls back to the default timeout for values above the timer max", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GITHUB_API_TIMEOUT_MS = String(MAX_TIMER_MS + 1);

    expect(getGitHubApiTimeoutMs()).toBe(GITHUB_CONFIG_DEFAULTS.API_TIMEOUT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_API_TIMEOUT_MS"),
    );
  });

  it("warns and clamps values below the minimum timeout", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GITHUB_API_TIMEOUT_MS = "50";

    expect(getGitHubApiTimeoutMs()).toBe(
      GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("below the minimum"),
    );
  });

  it("includes the resolved API timeout in the service config", () => {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nkey";
    process.env.GITHUB_API_TIMEOUT_MS = "3500";

    expect(getGitHubConfig()).toMatchObject({
      appId: "123",
      privateKey: "-----BEGIN PRIVATE KEY-----\nkey",
      apiTimeoutMs: 3500,
    });
  });

  it("rejects configs below the minimum API timeout", () => {
    const result = validateGitHubConfig({
      appId: "123",
      privateKey: "-----BEGIN PRIVATE KEY-----\nkey",
      apiTimeoutMs: 50,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      `apiTimeoutMs must be at least ${GITHUB_CONFIG_DEFAULTS.MIN_API_TIMEOUT}`,
    );
  });
});
