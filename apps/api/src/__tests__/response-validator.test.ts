import type { AnswerableQuestionType } from "@nexus-form/shared";
import { describe, expect, it } from "vitest";

import {
  buildResponseAnswerRecord,
  validateReachableResponseData,
  validateResponseData,
} from "../lib/forms/response-validator";

function makeForm(
  questionId: string,
  type: AnswerableQuestionType,
  validation: Record<string, unknown> = {},
) {
  return {
    version: 1,
    settings: {},
    questions: [{ id: questionId, type, validation }],
  };
}

function makeResponse(
  questionId: string,
  questionType: string,
  data: Record<string, unknown> = {},
) {
  return { question_id: questionId, question_type: questionType, ...data };
}

describe("response validator pattern mismatch modes", () => {
  it("rejects short text mismatches in block mode", () => {
    const form = makeForm("q1", "short_text", {
      pattern: "^NF-\\d{4}$",
      patternMismatchMode: "block",
    });

    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "draft" })],
      form,
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match the required pattern"),
      ]),
    );
  });

  it.each([
    "warn",
    "hidden",
  ] as const)("allows short text mismatches in %s mode", (patternMismatchMode) => {
    const form = makeForm("q1", "short_text", {
      pattern: "^NF-\\d{4}$",
      patternMismatchMode,
    });

    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "draft" })],
      form,
    );

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it("does not execute unsafe short text patterns during submit validation", () => {
    const form = makeForm("q1", "short_text", {
      pattern: "((?:a|b)+)+",
      patternMismatchMode: "block",
    });

    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "draft" })],
      form,
    );

    expect(result).toEqual({ isValid: true, errors: [] });
  });
});

describe("response validator other text validation", () => {
  it.each([
    "radio",
    "dropdown",
  ] as const)("applies block-mode other text rules to %s", (type) => {
    const form = makeForm("q1", type, {
      allowOther: true,
      options: [{ id: "a", label: "A" }],
      otherTextValidation: {
        minLength: 3,
        pattern: "^NF-\\d{4}$",
        patternMismatchMode: "block",
      },
    });

    const result = validateResponseData(
      [makeResponse("q1", type, { value: "other", other_value: "x" })],
      form,
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("at least 3"),
        expect.stringContaining("does not match the required pattern"),
      ]),
    );
  });

  it("applies block-mode other text rules to checkbox values", () => {
    const form = makeForm("q1", "checkbox", {
      allowOther: true,
      options: [{ id: "a", label: "A" }],
      otherTextValidation: {
        maxLength: 4,
        pattern: "^NF-\\d{4}$",
        patternMismatchMode: "block",
      },
    });

    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["other"],
          other_values: ["too-long"],
        }),
      ],
      form,
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("at most 4"),
        expect.stringContaining("does not match the required pattern"),
      ]),
    );
  });

  it.each([
    "warn",
    "hidden",
  ] as const)("allows other text pattern mismatches in %s mode", (patternMismatchMode) => {
    const form = makeForm("q1", "radio", {
      allowOther: true,
      options: [{ id: "a", label: "A" }],
      otherTextValidation: {
        pattern: "^NF-\\d{4}$",
        patternMismatchMode,
      },
    });

    const result = validateResponseData(
      [
        makeResponse("q1", "radio", {
          value: "other",
          other_value: "draft",
        }),
      ],
      form,
    );

    expect(result).toEqual({ isValid: true, errors: [] });
  });
});

describe("public submit reachability validation helpers", () => {
  it("builds condition-evaluator response records without presentation fields", () => {
    expect(
      buildResponseAnswerRecord([
        makeResponse("q-text", "short_text", {
          question_title: "Secret title",
          value: "text answer",
        }),
        makeResponse("q-check", "checkbox", {
          value: "ignored",
          values: ["a", "b"],
          other_values: ["private"],
        }),
        makeResponse("q-grid", "choice_grid", {
          responses: { row1: "col1" },
        }),
      ]),
    ).toEqual({
      "q-text": "text answer",
      "q-check": ["a", "b"],
      "q-grid": { row1: "col1" },
    });
  });

  it("rejects responses outside the server-computed reachable set without logging values", () => {
    const result = validateReachableResponseData(
      [
        makeResponse("q-entry", "radio", { value: "individual" }),
        makeResponse("q-hidden", "short_text", { value: "sensitive" }),
      ],
      new Set(["q-entry"]),
    );

    expect(result).toEqual({
      isValid: false,
      errors: ["Response 2: Question q-hidden is not reachable"],
    });
    expect(result.errors.join(" ")).not.toContain("sensitive");
  });
});
