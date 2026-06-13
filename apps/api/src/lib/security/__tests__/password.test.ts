import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("password security helpers", () => {
  it("preserves leading and trailing whitespace as part of the secret", async () => {
    const hash = await hashPassword(" secret123 ");

    await expect(verifyPassword(" secret123 ", hash)).resolves.toBe(true);
    await expect(verifyPassword("secret123", hash)).resolves.toBe(false);
  });
});
