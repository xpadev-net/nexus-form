import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isFormSecurityBypassEnabled,
  isHCaptchaBypassEnabled,
} from "../form-security-bypass";
import {
  CaptchaVerificationError,
  verifyCaptchaToken,
  verifyHCaptcha,
  verifyHCaptchaToken,
} from "../hcaptcha";

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

  it("bypasses hCaptcha verification in development when explicitly disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    vi.stubEnv("HCAPTCHA_SECRET_KEY", "");

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bypasses hCaptcha verification in development with the form security bypass flag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "true");
    vi.stubEnv("HCAPTCHA_SECRET_KEY", "");

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bypasses hCaptcha verification in development with the server-side flag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DISABLE_HCAPTCHA", "true");
    vi.stubEnv("HCAPTCHA_SECRET_KEY", "");

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps legacy hCaptcha flags scoped out of the full form security bypass", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "false");
    vi.stubEnv("DISABLE_HCAPTCHA", "true");

    expect(isHCaptchaBypassEnabled()).toBe(true);
    expect(isFormSecurityBypassEnabled()).toBe(false);
  });

  it("does not bypass hCaptcha verification when NODE_ENV is unset", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    vi.stubEnv("NODE_ENV", "");
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not bypass hCaptcha verification in staging", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not bypass hCaptcha verification in production with the form security bypass flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FORM_SECURITY_DEV_BYPASS", "true");
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not bypass hCaptcha verification in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyHCaptchaToken("token")).resolves.toMatchObject({
      success: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
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

describe("verifyCaptchaToken with Turnstile", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret");
    vi.stubEnv("VITE_BASE_URL", "https://forms.example.com");
  });

  it("verifies a Turnstile token against Cloudflare siteverify", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(
      verifyCaptchaToken("token", { remoteip: "203.0.113.10" }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("secret=turnstile-secret"),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("remoteip=203.0.113.10"),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("idempotency_key="),
      }),
    );
  });

  it("rejects a Turnstile token issued for a different hostname", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "attacker.example.com",
      challenge_ts: new Date(now.getTime() - 30_000).toISOString(),
    });

    await expect(verifyCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "Turnstile hostname mismatch",
    });
  });

  it("rejects a stale Turnstile challenge after five minutes", async () => {
    mockSiteVerifyResponse({
      success: true,
      hostname: "forms.example.com",
      challenge_ts: new Date(now.getTime() - 301_000).toISOString(),
    });

    await expect(verifyCaptchaToken("token")).resolves.toMatchObject({
      success: false,
      errorMessage: "Turnstile challenge timestamp is too old",
    });
  });

  it("fails closed when Turnstile secret is missing", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    await expect(verifyCaptchaToken("token")).rejects.toThrow(
      "TURNSTILE_SECRET_KEY is not configured",
    );
  });

  it("preserves the Turnstile verification error type after retry exhaustion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    await expect(
      verifyCaptchaToken("token", { maxRetries: 0 }),
    ).rejects.toThrow(CaptchaVerificationError);
    await expect(
      verifyCaptchaToken("token", { maxRetries: 0 }),
    ).rejects.toThrow("Failed to verify Turnstile token after 1 attempts");
  });

  it("throws a configuration error for invalid CAPTCHA providers", async () => {
    vi.stubEnv("CAPTCHA_PROVIDER", "turnstyle");

    await expect(verifyCaptchaToken("token")).rejects.toThrow();
    await expect(verifyHCaptcha("token")).rejects.toThrow();
  });
});
