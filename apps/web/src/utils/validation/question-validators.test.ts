import { describe, expect, it } from "vitest";
import type { Block } from "@/types/domain/form-block";
import {
  validateDate,
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
});
