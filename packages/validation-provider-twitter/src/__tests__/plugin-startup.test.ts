import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

const STARTUP_IMPORT_TEST_TIMEOUT_MS = 20_000;

describe("twitter provider startup configuration", () => {
  it(
    "fails module loading for allow-list mismatched Twitter base URLs",
    async () => {
      vi.stubEnv("TWITTER_BASE_URL", "https://internal.example.test");

      await expect(import("../plugin")).rejects.toThrow(
        "Twitter base URL host must be one of: api.twitter.com",
      );
    },
    STARTUP_IMPORT_TEST_TIMEOUT_MS,
  );

  it(
    "does not require the bearer token during startup-only base URL validation",
    async () => {
      vi.stubEnv("TWITTER_BASE_URL", "https://api.twitter.com");
      vi.stubEnv("TWITTER_BEARER_TOKEN", "");

      await expect(import("../plugin")).resolves.toMatchObject({
        twitterProvider: expect.objectContaining({ name: "twitter" }),
      });
    },
    STARTUP_IMPORT_TEST_TIMEOUT_MS,
  );
});
