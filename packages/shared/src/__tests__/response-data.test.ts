import { describe, expect, it } from "vitest";
import {
  MAX_RESPONSE_GRID_ROWS,
  MAX_RESPONSE_GRID_SELECTIONS_PER_ROW,
  MAX_RESPONSE_ID_LENGTH,
  MAX_RESPONSE_SELECTIONS,
  MAX_RESPONSE_TEXT_LENGTH,
  responsePayloadItemSchema,
} from "../response-data";

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
});
