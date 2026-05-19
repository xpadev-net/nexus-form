import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("field-encryption", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GOOGLE_OAUTH_ENC_KEY = "test-google-oauth-key";
    delete process.env.AUTH_SECRET;
  });

  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_ENC_KEY;
    delete process.env.AUTH_SECRET;
  });

  it("requires GOOGLE_OAUTH_ENC_KEY instead of falling back to AUTH_SECRET", async () => {
    delete process.env.GOOGLE_OAUTH_ENC_KEY;
    process.env.AUTH_SECRET = "auth-secret-must-not-be-used";
    const { assertGoogleOAuthEncryptionKeyConfigured, encryptToBase64 } =
      await import("../field-encryption");

    expect(() => assertGoogleOAuthEncryptionKeyConfigured()).toThrow(
      "GOOGLE_OAUTH_ENC_KEY environment variable is required",
    );
    expect(() => encryptToBase64("token")).toThrow(
      "GOOGLE_OAUTH_ENC_KEY environment variable is required",
    );
  });

  it("keeps encrypted tokens independent from AUTH_SECRET rotations", async () => {
    process.env.AUTH_SECRET = "auth-secret-before-rotation";
    const { decryptFromBase64, encryptToBase64 } = await import(
      "../field-encryption"
    );

    const payload = encryptToBase64("refresh-token");
    process.env.AUTH_SECRET = "auth-secret-after-rotation";

    expect(decryptFromBase64(payload)).toBe("refresh-token");
  });
});
