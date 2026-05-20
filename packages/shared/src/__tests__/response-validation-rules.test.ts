import { describe, expect, it } from "vitest";
import {
  getTextLengthViolations,
  isBlankResponseValue,
  parseFiniteResponseNumber,
  textMatchesPattern,
} from "../response-validation-rules";

describe("response validation rules", () => {
  it("detects blank response values consistently", () => {
    expect(isBlankResponseValue(undefined)).toBe(true);
    expect(isBlankResponseValue(null)).toBe(true);
    expect(isBlankResponseValue("   ")).toBe(true);
    expect(isBlankResponseValue("value")).toBe(false);
    expect(isBlankResponseValue(0)).toBe(false);
  });

  it("reports text length violations", () => {
    expect(
      getTextLengthViolations("abc", { minLength: 4, maxLength: 5 }),
    ).toEqual([{ code: "MIN_LENGTH", limit: 4, length: 3 }]);
    expect(getTextLengthViolations("abcdef", { maxLength: 5 })).toEqual([
      { code: "MAX_LENGTH", limit: 5, length: 6 },
    ]);
    expect(getTextLengthViolations("abcde", { minLength: 4 })).toEqual([]);
  });

  it("evaluates regular expression patterns", () => {
    expect(textMatchesPattern("abc-123", "^[a-z]+-\\d+$")).toBe(true);
    expect(textMatchesPattern("abc", "^\\d+$")).toBe(false);
  });

  it("parses only finite numeric response values", () => {
    expect(parseFiniteResponseNumber(4)).toBe(4);
    expect(parseFiniteResponseNumber("4.5")).toBe(4.5);
    expect(parseFiniteResponseNumber("")).toBe(0);
    expect(parseFiniteResponseNumber("NaN")).toBeNull();
    expect(parseFiniteResponseNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseFiniteResponseNumber(true)).toBeNull();
  });
});
