import { describe, expect, it } from "vitest";
import { validationProviderResultSchema } from "../plugin-interface";

describe("validationProviderResultSchema", () => {
  it("accepts multiple scalar output values", () => {
    expect(
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [
          { key: "username", label: "Username", value: "octocat" },
          { key: "followers", value: 42 },
          { key: "verified", value: true },
          { key: "bio", value: null },
        ],
      }),
    ).toEqual({
      isValid: true,
      outputValues: [
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: 42 },
        { key: "verified", value: true },
        { key: "bio", value: null },
      ],
    });
  });

  it("keeps legacy provider results without output values valid", () => {
    expect(
      validationProviderResultSchema.parse({
        isValid: true,
        metadata: { legacy: true },
      }),
    ).toEqual({
      isValid: true,
      metadata: { legacy: true },
    });
  });

  it("rejects malformed output values", () => {
    expect(() =>
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [{ key: "profile", value: { url: "bad" } }],
      }),
    ).toThrow();

    expect(() =>
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [
          { key: "username", value: "octocat" },
          { key: "username", value: "duplicate" },
        ],
      }),
    ).toThrow();
  });
});
