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
});
