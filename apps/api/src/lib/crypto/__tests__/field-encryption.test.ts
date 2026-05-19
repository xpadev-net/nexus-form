import type { BinaryLike } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scryptSyncMock } = vi.hoisted(() => ({
  scryptSyncMock: vi.fn(),
}));

describe("field-encryption", () => {
  beforeEach(() => {
    vi.resetModules();
    scryptSyncMock.mockReset();
    process.env.GOOGLE_OAUTH_ENC_KEY = "test-google-oauth-key";
    delete process.env.AUTH_SECRET;
    vi.doMock("node:crypto", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:crypto")>();
      scryptSyncMock.mockImplementation(
        (password: BinaryLike, salt: BinaryLike, keylen: number) =>
          actual.scryptSync(password, salt, keylen),
      );

      return {
        ...actual,
        scryptSync: scryptSyncMock,
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("node:crypto");
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

  it("derives the raw encryption key only once per module instance", async () => {
    const { decryptFromBase64, encryptToBase64 } = await import(
      "../field-encryption"
    );

    const firstPayload = encryptToBase64("first-token");
    const secondPayload = encryptToBase64("second-token");

    expect(decryptFromBase64(firstPayload)).toBe("first-token");
    expect(decryptFromBase64(secondPayload)).toBe("second-token");
    expect(scryptSyncMock).toHaveBeenCalledTimes(1);
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
