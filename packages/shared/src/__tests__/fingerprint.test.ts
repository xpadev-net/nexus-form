import { describe, expect, it } from "vitest";
import { buildFingerprintComponentKey } from "../fingerprint";

describe("buildFingerprintComponentKey", () => {
  it("escapes separator collisions between provider and component names", () => {
    const first = buildFingerprintComponentKey("a:b", "c");
    const second = buildFingerprintComponentKey("a", "b:c");

    expect(first).toBe("a\\:b:c");
    expect(second).toBe("a:b\\:c");
    expect(first).not.toBe(second);
  });

  it("escapes backslashes deterministically", () => {
    expect(buildFingerprintComponentKey("a\\b", "c\\d")).toBe("a\\\\b:c\\\\d");
  });
});
