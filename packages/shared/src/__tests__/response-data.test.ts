import { describe, expect, it } from "vitest";
import {
  isIsoCalendarDate,
  MAX_RESPONSE_GRID_ROWS,
  MAX_RESPONSE_GRID_SELECTIONS_PER_ROW,
  MAX_RESPONSE_ID_LENGTH,
  MAX_RESPONSE_SELECTIONS,
  MAX_RESPONSE_TEXT_LENGTH,
  questionValidationSchema,
  responseDataItemSchema,
  responsePayloadItemSchema,
} from "../response-data";

describe("isIsoCalendarDate", () => {
  it("accepts real ISO calendar dates", () => {
    expect(isIsoCalendarDate("2026-02-28")).toBe(true);
    expect(isIsoCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects impossible or non-ISO dates", () => {
    expect(isIsoCalendarDate("2026-02-31")).toBe(false);
    expect(isIsoCalendarDate("2026-6-15")).toBe(false);
    expect(isIsoCalendarDate(" 2026-06-15 ")).toBe(false);
  });
});

describe("questionValidationSchema", () => {
  it("accepts pattern mismatch modes and choice other validation rules", () => {
    const result = questionValidationSchema.safeParse({
      type: "radio",
      patternMismatchMode: "hidden",
      allowPatternMismatch: true,
      otherTextValidation: {
        required: true,
        minLength: 2,
        maxLength: 10,
        pattern: "^.+$",
        patternMismatchMode: "warn",
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("responsePayloadItemSchema", () => {
  const baseResponse = {
    question_id: "question-1",
    question_type: "short_text",
  };

  it("rejects oversized scalar strings", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      value: "x".repeat(MAX_RESPONSE_TEXT_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized selection arrays", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      values: Array.from(
        { length: MAX_RESPONSE_SELECTIONS + 1 },
        (_, index) => `option-${index}`,
      ),
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized grid response maps", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      responses: Object.fromEntries(
        Array.from({ length: MAX_RESPONSE_GRID_ROWS + 1 }, (_, index) => [
          `row-${index}`,
          ["option-1"],
        ]),
      ),
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized grid row selections", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      responses: {
        row: Array.from(
          { length: MAX_RESPONSE_GRID_SELECTIONS_PER_ROW + 1 },
          (_, index) => `option-${index}`,
        ),
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts single-selection choice grid responses", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      question_type: "choice_grid",
      responses: {
        row1: "column1",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects array-valued choice grid responses", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      question_type: "choice_grid",
      responses: {
        row1: ["column1"],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects scalar-valued checkbox grid responses", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      question_type: "checkbox_grid",
      responses: {
        row1: "column1",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized response identifiers", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      question_id: "q".repeat(MAX_RESPONSE_ID_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it("strips client-supplied pattern match metadata from response payloads", () => {
    const result = responsePayloadItemSchema.safeParse({
      ...baseResponse,
      value: "NF-123",
      validation_metadata: {
        pattern_match: {
          status: "mismatch",
          mode: "hidden",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected payload parse success");
    expect("validation_metadata" in result.data).toBe(false);
  });
});

describe("responseDataItemSchema", () => {
  const baseResponse = {
    question_id: "question-1",
    question_type: "short_text",
  };

  it("accepts pattern match metadata for later response consumers", () => {
    const result = responseDataItemSchema.safeParse({
      ...baseResponse,
      value: "NF-123",
      validation_metadata: {
        pattern_match: {
          status: "match",
          mode: "warn",
          pattern: "^NF-[0-9]+$",
          patternTemplate: "nexus_id",
        },
        other_text_pattern_match: {
          status: "unchecked",
          mode: "hidden",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected metadata parse success");
    expect(result.data.validation_metadata).toEqual({
      pattern_match: {
        status: "match",
        mode: "warn",
        pattern: "^NF-[0-9]+$",
        patternTemplate: "nexus_id",
      },
      other_text_pattern_match: {
        status: "unchecked",
        mode: "hidden",
      },
    });
  });
});
