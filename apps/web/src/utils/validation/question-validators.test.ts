import type { ExtractedQuestion } from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import type { Block } from "@/types/domain/form-block";
import {
  type AnswerLike,
  validateCheckbox,
  validateDate,
  validateDropdown,
  validateExtractedQuestionAnswer,
  validateRadio,
  validateShortText,
  validateTime,
} from "./question-validators";

function shortTextQuestion(
  validation: Extract<Block, { type: "short_text" }>["validation"],
): Extract<Block, { type: "short_text" }> {
  return {
    id: "block-row-1",
    formId: "form-1",
    blockId: "q1",
    type: "short_text",
    category: "question",
    order: 0,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    title: "Question",
    validation,
  };
}

function dateQuestion(
  validation: Extract<Block, { type: "date" }>["validation"],
): Extract<Block, { type: "date" }> {
  return {
    id: "block-row-2",
    formId: "form-1",
    blockId: "q2",
    type: "date",
    category: "question",
    order: 1,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    title: "Date",
    validation,
  };
}

function timeQuestion(
  validation: Extract<Block, { type: "time" }>["validation"],
): Extract<Block, { type: "time" }> {
  return {
    id: "block-row-3",
    formId: "form-1",
    blockId: "q3",
    type: "time",
    category: "question",
    order: 2,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    title: "Time",
    validation,
  };
}

function radioQuestion(
  validation: Extract<Block, { type: "radio" }>["validation"],
): Extract<Block, { type: "radio" }> {
  return {
    id: "block-row-4",
    formId: "form-1",
    blockId: "q4",
    type: "radio",
    category: "question",
    order: 3,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    title: "Radio",
    validation,
  };
}

function checkboxQuestion(
  validation: Extract<Block, { type: "checkbox" }>["validation"],
): Extract<Block, { type: "checkbox" }> {
  return {
    id: "block-row-5",
    formId: "form-1",
    blockId: "q5",
    type: "checkbox",
    category: "question",
    order: 4,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    title: "Checkbox",
    validation,
  };
}

function dropdownQuestion(
  validation: Extract<Block, { type: "dropdown" }>["validation"],
): Extract<Block, { type: "dropdown" }> {
  return {
    id: "block-row-6",
    formId: "form-1",
    blockId: "q6",
    type: "dropdown",
    category: "question",
    order: 5,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    title: "Dropdown",
    validation,
  };
}

function extractedQuestion(
  type: string,
  validation: Record<string, unknown>,
): ExtractedQuestion {
  return {
    blockId: `q-${type}`,
    type,
    title: `${type} question`,
    validation,
  };
}

function errorCodesFor(
  question: ExtractedQuestion,
  answer: AnswerLike | undefined,
): string[] {
  return validateExtractedQuestionAnswer(question, answer).errors.map(
    (error) => error.code,
  );
}

describe("question validators", () => {
  it("treats whitespace-only optional short_text as blank before length and pattern checks", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        minLength: 5,
        pattern: "^\\d+$",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "   " },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("rejects short_text values that do not match a blocking pattern", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "^NF-\\d{4}$",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "draft" },
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "PATTERN_MISMATCH",
    ]);
  });

  it("rejects non-matching values for safe non-capturing group patterns", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "^(?:[A-Z]{2}-\\d{4})+$",
        patternMismatchMode: "block",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "draft" },
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "PATTERN_MISMATCH",
    ]);
  });

  it("allows short_text pattern mismatches when the validation permits them", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "^NF-\\d{4}$",
        allowPatternMismatch: true,
      }),
      { question_type: "short_text", value: "draft" },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("returns a respondent-visible warning for short_text warn mode", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "^NF-\\d{4}$",
        patternMismatchMode: "warn",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "draft" },
    );

    expect(result.is_valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings?.map((warning) => warning.code)).toEqual([
      "PATTERN_MISMATCH",
    ]);
  });

  it("hides short_text pattern mismatches in hidden mode", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "^NF-\\d{4}$",
        patternMismatchMode: "hidden",
        allowPatternMismatch: true,
      }),
      { question_type: "short_text", value: "draft" },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("keeps email template validation blocking unless legacy mismatch allowance is enabled", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        patternTemplate: "email",
        patternMismatchMode: "hidden",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "not-an-email" },
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(["EMAIL_INVALID"]);
  });

  it("allows email template mismatches when legacy mismatch allowance is enabled", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        patternTemplate: "email",
        patternMismatchMode: "hidden",
        allowPatternMismatch: true,
      }),
      { question_type: "short_text", value: "not-an-email" },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("does not reject or throw when short_text has an invalid regex pattern", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "[",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "anything" },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("does not execute unsafe short_text regex patterns during inline validation", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "((?:a|b)+)+",
        patternMismatchMode: "block",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "draft" },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("does not bypass unsafe regex detection after escaped literal backslashes", () => {
    const result = validateShortText(
      shortTextQuestion({
        type: "short_text",
        required: false,
        pattern: "\\\\(a+)+",
        patternMismatchMode: "block",
        allowPatternMismatch: false,
      }),
      { question_type: "short_text", value: "aaaaaaaaaaaaaaaaaaaaaaaa!" },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("validates radio other text with short-text-equivalent rules", () => {
    const result = validateRadio(
      radioQuestion({
        type: "radio",
        required: false,
        options: [{ id: "a", label: "A" }],
        allowOther: true,
        otherTextValidation: {
          required: false,
          minLength: 3,
          pattern: "^NF-\\d{4}$",
          patternMismatchMode: "block",
        },
      }),
      { question_type: "radio", value: "other", other_value: "x" },
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "MIN_LENGTH",
      "PATTERN_MISMATCH",
    ]);
  });

  it("validates dropdown other text with short-text-equivalent rules", () => {
    const result = validateDropdown(
      dropdownQuestion({
        type: "dropdown",
        required: false,
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        allowOther: true,
        otherTextValidation: {
          required: false,
          maxLength: 4,
          pattern: "^NF-\\d{4}$",
          patternMismatchMode: "block",
        },
      }),
      {
        question_type: "dropdown",
        value: "other",
        other_value: "too-long",
      },
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "MAX_LENGTH",
      "PATTERN_MISMATCH",
    ]);
  });

  it("returns warnings for checkbox other text warn mode", () => {
    const result = validateCheckbox(
      checkboxQuestion({
        type: "checkbox",
        required: false,
        options: [{ id: "a", label: "A" }],
        allowOther: true,
        otherTextValidation: {
          required: false,
          pattern: "^NF-\\d{4}$",
          patternMismatchMode: "warn",
        },
      }),
      {
        question_type: "checkbox",
        values: ["other"],
        other_values: ["draft"],
      },
    );

    expect(result.is_valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings?.map((warning) => warning.code)).toEqual([
      "PATTERN_MISMATCH",
    ]);
  });

  it("treats whitespace-only optional date as blank before format checks", () => {
    const result = validateDate(
      dateQuestion({
        type: "date",
        required: false,
        format: "YYYY-MM-DD",
      }),
      { question_type: "date", value: "   " },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it("treats whitespace-only optional time as blank before format checks", () => {
    const result = validateTime(
      timeQuestion({
        type: "time",
        required: false,
        format: "24h",
      }),
      { question_type: "time", value: "   " },
    );

    expect(result).toEqual({ is_valid: true, errors: [] });
  });

  it.each([
    [
      "short_text min length",
      extractedQuestion("short_text", {
        required: false,
        minLength: 3,
      }),
      { value: "ab" },
      ["MIN_LENGTH"],
    ],
    [
      "short_text max length",
      extractedQuestion("short_text", {
        required: false,
        maxLength: 3,
      }),
      { value: "abcd" },
      ["MAX_LENGTH"],
    ],
    [
      "short_text pattern",
      extractedQuestion("short_text", {
        required: false,
        pattern: "^NF-\\d{4}$",
        allowPatternMismatch: false,
      }),
      { value: "draft" },
      ["PATTERN_MISMATCH"],
    ],
    [
      "long_text min length",
      extractedQuestion("long_text", {
        required: false,
        minLength: 4,
        maxLength: 8,
      }),
      { value: "abc" },
      ["MIN_LENGTH"],
    ],
    [
      "long_text max length",
      extractedQuestion("long_text", {
        required: false,
        minLength: 4,
        maxLength: 8,
      }),
      { value: "abcdefghi" },
      ["MAX_LENGTH"],
    ],
    [
      "radio option id",
      extractedQuestion("radio", {
        required: false,
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      }),
      { value: "maybe" },
      ["INVALID_OPTION"],
    ],
    [
      "checkbox option id and minimum selections",
      extractedQuestion("checkbox", {
        required: false,
        minSelections: 2,
        maxSelections: 3,
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
          { id: "green", label: "Green" },
        ],
      }),
      { values: ["yellow"] },
      ["INVALID_OPTIONS", "MIN_SELECTIONS"],
    ],
    [
      "checkbox maximum selections",
      extractedQuestion("checkbox", {
        required: false,
        maxSelections: 2,
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
          { id: "green", label: "Green" },
        ],
      }),
      { values: ["red", "blue", "green"] },
      ["MAX_SELECTIONS"],
    ],
    [
      "dropdown option id",
      extractedQuestion("dropdown", {
        required: false,
        options: [
          { id: "jp", label: "Japan" },
          { id: "us", label: "United States" },
        ],
      }),
      { value: "fr" },
      ["INVALID_OPTION"],
    ],
    [
      "linear_scale range",
      extractedQuestion("linear_scale", {
        required: false,
        min: 1,
        max: 5,
      }),
      { value: 6 },
      ["OUT_OF_RANGE"],
    ],
    [
      "rating range",
      extractedQuestion("rating", {
        required: false,
        maxRating: 5,
      }),
      { value: 6 },
      ["OUT_OF_RANGE"],
    ],
    [
      "choice_grid row and column ids",
      extractedQuestion("choice_grid", {
        required: true,
        rows: [
          { id: "row-a", label: "Row A" },
          { id: "row-b", label: "Row B" },
        ],
        columns: [
          { id: "col-1", label: "Column 1" },
          { id: "col-2", label: "Column 2" },
        ],
      }),
      { responses: { "row-a": "missing-col", "row-x": "col-1" } },
      ["MISSING_REQUIRED_ROWS", "INVALID_COLUMN", "INVALID_ROW"],
    ],
    [
      "checkbox_grid row, column, and selection count",
      extractedQuestion("checkbox_grid", {
        required: true,
        rows: [
          { id: "row-a", label: "Row A" },
          { id: "row-b", label: "Row B" },
        ],
        columns: [
          { id: "col-1", label: "Column 1" },
          { id: "col-2", label: "Column 2" },
        ],
        minSelectionsPerRow: 1,
        maxSelectionsPerRow: 1,
      }),
      { responses: { "row-a": [], "row-b": ["col-1", "missing-col"] } },
      ["MIN_SELECTIONS_PER_ROW", "INVALID_COLUMN", "MAX_SELECTIONS_PER_ROW"],
    ],
    [
      "date minimum range",
      extractedQuestion("date", {
        required: false,
        format: "YYYY-MM-DD",
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      }),
      { value: "2025-12-31" },
      ["DATE_TOO_EARLY"],
    ],
    [
      "date maximum range",
      extractedQuestion("date", {
        required: false,
        format: "YYYY-MM-DD",
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      }),
      { value: "2027-01-01" },
      ["DATE_TOO_LATE"],
    ],
    [
      "time minimum range",
      extractedQuestion("time", {
        required: false,
        format: "24h",
        minTime: "09:00",
        maxTime: "17:00",
      }),
      { value: "08:59" },
      ["TIME_TOO_EARLY"],
    ],
    [
      "time maximum range",
      extractedQuestion("time", {
        required: false,
        format: "24h",
        minTime: "09:00",
        maxTime: "17:00",
      }),
      { value: "17:01" },
      ["TIME_TOO_LATE"],
    ],
  ])("validates extracted %s answers before page navigation or submit", (_name, question, answer, expectedCodes) => {
    expect(errorCodesFor(question, answer)).toEqual(expectedCodes);
  });
});
