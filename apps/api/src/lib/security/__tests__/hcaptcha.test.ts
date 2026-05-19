import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHCaptchaToken } from "../hcaptcha";

const now = new Date("2026-05-19T00:00:00.000Z");

function mockSiteVerifyResponse(body: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }),
  );
}

describe("verifyHCaptchaToken", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("HCAPTCHA_SECRET_KEY", "secret");
    vi.stubEnv("VITE_BASE_URL", "https://forms.example.com");
  });

  it("accepts a successful response for the configured hostname and fresh challenge", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
      score: 0.9,
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
      score: 0.9,
    });
  });

  it("rejects a token issued for a different hostname", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "attacker.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "hCaptcha hostname mismatch",
    });
  });

  it("rejects a stale challenge timestamp", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 121_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "hCaptcha challenge timestamp is too old",
    });
  });

  it("rejects a future challenge timestamp", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() + 61_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "hCaptcha challenge timestamp is in the future",
    });
  });

  it("rejects an invalid challenge timestamp", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: "not-a-valid-date",
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "hCaptcha challenge timestamp is invalid",
    });
  });

  it("rejects a response without a challenge timestamp", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "hCaptcha challenge timestamp is missing",
    });
  });

  it("rejects verification when no expected hostname is configured", async () => {
    vi.stubEnv("HCAPTCHA_EXPECTED_HOSTNAMES", "");
    vi.stubEnv("TRUSTED_ORIGINS", "");
    vi.stubEnv("VITE_BASE_URL", "");
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "hCaptcha expected hostname is not configured",
    });
  });
});
