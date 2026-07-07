import { describe, expect, it } from "vitest";
import {
  CheckboxValidationConfig,
  DropdownValidationConfig,
  normalizePatternMismatchMode,
  normalizeShortTextValidationConfig,
  PatternMismatchMode,
  RadioValidationConfig,
  ShortTextValidationConfig,
} from "../forms/form-block";

describe("pattern mismatch validation contract", () => {
  it("accepts block, warn, and hidden pattern mismatch modes", () => {
    for (const mode of ["block", "warn", "hidden"] as const) {
      const parsed = ShortTextValidationConfig.parse({
        type: "short_text",
        pattern: "^NF-[0-9]+$",
        patternMismatchMode: mode,
      });

      expect(parsed.patternMismatchMode).toBe(mode);
      expect(PatternMismatchMode.parse(mode)).toBe(mode);
    }
  });

  it("normalizes legacy allowPatternMismatch values compatibly", () => {
    expect(normalizePatternMismatchMode(undefined)).toBe("block");
    expect(normalizePatternMismatchMode({ patternMismatchMode: "block" })).toBe(
      "block",
    );
    expect(normalizePatternMismatchMode({ allowPatternMismatch: false })).toBe(
      "block",
    );
    expect(normalizePatternMismatchMode({ allowPatternMismatch: true })).toBe(
      "hidden",
    );
    expect(
      normalizePatternMismatchMode({
        allowPatternMismatch: true,
        patternMismatchMode: "warn",
      }),
    ).toBe("warn");
  });

  it("normalizes short text validation configs without dropping legacy fields", () => {
    const parsed = ShortTextValidationConfig.parse({
      type: "short_text",
      pattern: "^NF-[0-9]+$",
      allowPatternMismatch: true,
    });

    expect(normalizeShortTextValidationConfig(parsed)).toMatchObject({
      type: "short_text",
      pattern: "^NF-[0-9]+$",
      allowPatternMismatch: true,
      patternMismatchMode: "hidden",
    });
  });
});

describe("choice other text validation contract", () => {
  const otherTextValidation = {
    required: true,
    minLength: 3,
    maxLength: 20,
    pattern: "^[A-Z][a-z]+$",
    patternTemplate: "capitalized_word",
    patternMismatchMode: "warn" as const,
  };

  it("accepts short-text-compatible other validation for radio questions", () => {
    const parsed = RadioValidationConfig.parse({
      type: "radio",
      options: [{ id: "known", label: "Known" }],
      allowOther: true,
      otherTextValidation,
    });

    expect(parsed.otherTextValidation).toEqual(otherTextValidation);
  });

  it("accepts short-text-compatible other validation for checkbox questions", () => {
    const parsed = CheckboxValidationConfig.parse({
      type: "checkbox",
      options: [{ id: "known", label: "Known" }],
      allowOther: true,
      otherTextValidation,
    });

    expect(parsed.otherTextValidation).toEqual(otherTextValidation);
  });

  it("accepts short-text-compatible other validation for dropdown questions", () => {
    const parsed = DropdownValidationConfig.parse({
      type: "dropdown",
      options: [
        { id: "known", label: "Known" },
        { id: "other-known", label: "Other known" },
      ],
      allowOther: true,
      otherTextValidation,
    });

    expect(parsed.otherTextValidation).toEqual(otherTextValidation);
  });
});
