import type {
  AnswerableQuestionType,
  QuestionValidation,
} from "@nexus-form/shared";
import { describe, expect, it } from "vitest";

import { validateResponseData } from "../response-validator";

/** Helper to build a minimal form structure for a single question. */
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

/** Helper to build a single response item. */
function makeResponse(
  questionId: string,
  questionType: string,
  data: Record<string, unknown> = {},
) {
  return { question_id: questionId, question_type: questionType, ...data };
}

// ---------------------------------------------------------------------------
// isSafeRegex integration
// ---------------------------------------------------------------------------
describe("isSafeRegex integration", () => {
  it("skips unsafe regex patterns such as nested quantifiers", () => {
    const form = makeForm("q1", "short_text", {
      pattern: "((?:a|b)+)+",
      allowPatternMismatch: false,
    });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "ab" })],
      form,
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts simple safe regex patterns", () => {
    const form = makeForm("q1", "short_text", {
      pattern: "^[a-z]+$",
      allowPatternMismatch: false,
    });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "abc" })],
      form,
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// required vs optional basic presence validation
// ---------------------------------------------------------------------------
describe("required vs optional basic presence validation", () => {
  it("returns invalid when formStructure is null", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "foo" })],
      null,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(["Invalid form structure"]);
  });

  it("does not require value for optional short_text", () => {
    const form = makeForm("q1", "short_text", { required: false });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: undefined })],
      form,
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("treats whitespace-only optional short_text as blank before length and pattern checks", () => {
    const form = makeForm("q1", "short_text", {
      required: false,
      minLength: 5,
      pattern: "^\\d+$",
      allowPatternMismatch: false,
    });

    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "   " })],
      form,
    );

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires value for required short_text", () => {
    const form = makeForm("q1", "short_text", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("does not require selections for optional checkbox", () => {
    const form = makeForm("q1", "checkbox", { required: false });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: [] })],
      form,
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("does not require date/time value for optional date/time", () => {
    const formStructure = {
      version: 1,
      settings: {},
      questions: [
        {
          id: "q1",
          type: "date" as const,
          validation: { required: false } satisfies QuestionValidation,
        },
        {
          id: "q2",
          type: "time" as const,
          validation: { required: false } satisfies QuestionValidation,
        },
      ],
    };
    const result = validateResponseData(
      [
        makeResponse("q1", "date", { value: undefined }),
        makeResponse("q2", "time", { value: undefined }),
      ],
      formStructure,
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("treats whitespace-only optional date/time as blank before format checks", () => {
    const formStructure = {
      version: 1,
      settings: {},
      questions: [
        {
          id: "q1",
          type: "date" as const,
          validation: { required: false } satisfies QuestionValidation,
        },
        {
          id: "q2",
          type: "time" as const,
          validation: { required: false } satisfies QuestionValidation,
        },
      ],
    };
    const result = validateResponseData(
      [
        makeResponse("q1", "date", { value: "   " }),
        makeResponse("q2", "time", { value: "   " }),
      ],
      formStructure,
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// minLength / maxLength
// ---------------------------------------------------------------------------
describe("text length validation", () => {
  const form = makeForm("q1", "short_text", { minLength: 3, maxLength: 10 });

  it("rejects text shorter than minLength", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "ab" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("at least 3")]),
    );
  });

  it("rejects text longer than maxLength", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "a".repeat(11) })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("at most 10")]),
    );
  });

  it("accepts text within bounds", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "hello" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("skips minLength check for empty value on non-required field", () => {
    const optionalForm = makeForm("q1", "short_text", { minLength: 5 });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "" })],
      optionalForm,
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("at least 5")]),
    );
  });
});

// ---------------------------------------------------------------------------
// Date range + format validation
// ---------------------------------------------------------------------------
describe("date validation", () => {
  const form = makeForm("q1", "date", {
    minDate: "2025-01-01",
    maxDate: "2025-12-31",
  });

  it("rejects date before minDate", () => {
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "2024-12-31" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("on or after")]),
    );
  });

  it("rejects date after maxDate", () => {
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "2026-01-01" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("on or before")]),
    );
  });

  it("accepts date within range", () => {
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "2025-06-15" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "2025-6-15" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid date format")]),
    );
  });

  it("rejects impossible calendar dates", () => {
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "2025-02-31" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid date format")]),
    );
  });
});

// ---------------------------------------------------------------------------
// Time range + format validation
// ---------------------------------------------------------------------------
describe("time validation", () => {
  const form = makeForm("q1", "time", {
    minTime: "09:00",
    maxTime: "17:00",
  });

  it("rejects time before minTime", () => {
    const result = validateResponseData(
      [makeResponse("q1", "time", { value: "08:59" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("on or after")]),
    );
  });

  it("rejects time after maxTime", () => {
    const result = validateResponseData(
      [makeResponse("q1", "time", { value: "17:01" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("on or before")]),
    );
  });

  it("accepts time within range", () => {
    const result = validateResponseData(
      [makeResponse("q1", "time", { value: "12:30" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects invalid time format", () => {
    const result = validateResponseData(
      [makeResponse("q1", "time", { value: "9:00" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid time format")]),
    );
  });
});

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------
describe("pattern validation", () => {
  const form = makeForm("q1", "short_text", {
    pattern: "^[a-z]+@[a-z]+\\.[a-z]+$",
  });

  it("rejects value not matching pattern", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "not-an-email" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match the required pattern"),
      ]),
    );
  });

  it("accepts value matching pattern", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "test@example.com" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("skips check when allowPatternMismatch is true", () => {
    const permissiveForm = makeForm("q1", "short_text", {
      pattern: "^\\d+$",
      allowPatternMismatch: true,
    });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "abc" })],
      permissiveForm,
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match the required pattern"),
      ]),
    );
  });

  it("skips ReDoS-prone patterns", () => {
    const dangerousForm = makeForm("q1", "short_text", {
      pattern: "(a+)+",
    });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "aaa" })],
      dangerousForm,
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match the required pattern"),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// allowOther text (required radio/dropdown/checkbox)
// ---------------------------------------------------------------------------
describe("allowOther text validation", () => {
  it("rejects required radio with other selected but empty text", () => {
    const form = makeForm("q1", "radio", {
      required: true,
      allowOther: true,
    });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "other", other_value: "" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });

  it("accepts required radio with other selected and text provided", () => {
    const form = makeForm("q1", "radio", {
      required: true,
      allowOther: true,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "radio", {
          value: "other",
          other_value: "custom answer",
        }),
      ],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects non-required radio with other selected but empty text", () => {
    const form = makeForm("q1", "radio", {
      required: false,
      allowOther: true,
    });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "other", other_value: "" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });

  it("rejects non-required checkbox with other selected but empty other_values", () => {
    const form = makeForm("q1", "checkbox", {
      required: false,
      allowOther: true,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["other"],
          other_values: [""],
        }),
      ],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });

  it("rejects required checkbox with other selected but empty other_values", () => {
    const form = makeForm("q1", "checkbox", {
      required: true,
      allowOther: true,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["other"],
          other_values: [""],
        }),
      ],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });

  it("rejects required checkbox with other selected but whitespace-only other_values", () => {
    const form = makeForm("q1", "checkbox", {
      required: true,
      allowOther: true,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["other"],
          other_values: ["   "],
        }),
      ],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Checkbox minSelections / maxSelections
// ---------------------------------------------------------------------------
describe("checkbox selection limits", () => {
  it("rejects fewer than minSelections", () => {
    const form = makeForm("q1", "checkbox", { minSelections: 2 });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: ["a"] })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("At least 2")]),
    );
  });

  it("rejects more than maxSelections", () => {
    const form = makeForm("q1", "checkbox", { maxSelections: 2 });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: ["a", "b", "c"] })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("At most 2")]),
    );
  });

  it("accepts selection count within limits", () => {
    const form = makeForm("q1", "checkbox", {
      minSelections: 1,
      maxSelections: 3,
    });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: ["a", "b"] })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grid minSelectionsPerRow / maxSelectionsPerRow
// ---------------------------------------------------------------------------
describe("checkbox_grid per-row selection limits", () => {
  const rows = [
    { id: "r1", label: "Row 1" },
    { id: "r2", label: "Row 2" },
    { id: "r3", label: "Row 3" },
  ];

  it("rejects row with fewer than minSelectionsPerRow (required)", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: true,
      minSelectionsPerRow: 1,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1"], r2: [], r3: ["c2"] },
        }),
      ],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r2 requires at least 1"),
      ]),
    );
  });

  it("rejects row with more than maxSelectionsPerRow", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: true,
      maxSelectionsPerRow: 1,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1", "c2"], r2: ["c1"], r3: ["c1"] },
        }),
      ],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r1 allows at most 1"),
      ]),
    );
  });

  it("skips untouched rows for non-required grid", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: false,
      minSelectionsPerRow: 1,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1"] },
        }),
      ],
      form,
    );
    // r2 and r3 are untouched — should NOT generate errors
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Row r2")]),
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Row r3")]),
    );
  });

  it("enforces minSelectionsPerRow on touched empty rows in optional grid", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: false,
      minSelectionsPerRow: 1,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1"], r2: [] },
        }),
      ],
      form,
    );
    // r2 is touched (key exists with empty array) — minSelectionsPerRow should be enforced
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r2 requires at least 1"),
      ]),
    );
    // r3 is untouched (key absent) — should NOT generate errors
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Row r3")]),
    );
  });

  it("enforces all rows for required grid even when untouched", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: true,
      minSelectionsPerRow: 1,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1"] },
        }),
      ],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r2 requires at least 1"),
        expect.stringContaining("Row r3 requires at least 1"),
      ]),
    );
  });

  it("rejects missing rows for required grid without minSelectionsPerRow", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: true,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1"] },
        }),
      ],
      form,
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r2 requires a selection"),
        expect.stringContaining("Row r3 requires a selection"),
      ]),
    );
  });

  it("rejects empty touched rows for required grid without minSelectionsPerRow", () => {
    const form = makeForm("q1", "checkbox_grid", {
      required: true,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox_grid", {
          responses: { r1: ["c1"], r2: [] },
        }),
      ],
      form,
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r2 requires a selection"),
      ]),
    );
  });
});

describe("choice_grid row validation", () => {
  const rows = [
    { id: "r1", label: "Row 1" },
    { id: "r2", label: "Row 2" },
  ];

  it("rejects missing rows for required choice grid", () => {
    const form = makeForm("q1", "choice_grid", {
      required: true,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "choice_grid", {
          responses: { r1: "c1" },
        }),
      ],
      form,
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Row r2 requires a selection"),
      ]),
    );
  });

  it("rejects array-valued rows for choice grid", () => {
    const form = makeForm("q1", "choice_grid", {
      required: true,
      rows,
    });
    const result = validateResponseData(
      [
        makeResponse("q1", "choice_grid", {
          responses: { r1: ["c1"], r2: "c2" },
        }),
      ],
      form,
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Choice grid row r1 must contain"),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown question ID / unknown question type
// ---------------------------------------------------------------------------
describe("unknown question ID and type detection", () => {
  it("reports unknown question_id when questions are defined", () => {
    const form = makeForm("q1", "short_text");
    const result = validateResponseData(
      [
        makeResponse("q1", "short_text", { value: "ok" }),
        makeResponse("q999", "short_text", { value: "bad" }),
      ],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Unknown question ID q999"),
      ]),
    );
  });

  it("reports unknown question_id when questions list is empty", () => {
    const form = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "ok" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown question ID")]),
    );
  });

  it("reports unknown question type when question definition exists", () => {
    const form = makeForm("q1", "short_text");
    const result = validateResponseData(
      [makeResponse("q1", "bogus_type", { value: "test" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Question type mismatch"),
      ]),
    );
  });

  it("rejects unknown question type when questions list is empty", () => {
    const form = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "bogus_type", { value: "test" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown question ID")]),
    );
  });

  it("rejects non-primitive value for unknown question type when questions list is empty", () => {
    const form = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "future_type", { value: { nested: "obj" } })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Non-primitive value is not allowed");
  });

  it("rejects array value for unknown question type when questions list is empty", () => {
    const form = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "future_type", { value: [1, 2, 3] })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Non-primitive value is not allowed");
  });

  it("rejects primitive value for unknown question type when questions list is empty", () => {
    const form = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "future_type", { value: "hello" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown question ID")]),
    );
  });
});

// ---------------------------------------------------------------------------
// Required question with no response (branching skip)
// ---------------------------------------------------------------------------
describe("required question with no response (branching skip)", () => {
  it("does not error when a required question receives no response", () => {
    const formStructure = {
      version: 1,
      settings: {},
      questions: [
        {
          id: "q1",
          type: "short_text" as const,
          validation: { required: true },
        },
        {
          id: "q2",
          type: "short_text" as const,
          validation: { required: true },
        },
      ],
    };
    // Only q1 answered — q2 may have been skipped via page branching
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "answered" })],
      formStructure,
    );
    // q2 未回答自体はエラーにならない（ロジック分岐でスキップされた可能性がある）
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// linear_scale / rating numeric validation
// ---------------------------------------------------------------------------
describe("linear_scale / rating numeric validation", () => {
  it("accepts valid numeric value for required rating", () => {
    const form = makeForm("q1", "rating", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 3 })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("accepts valid numeric string for required linear_scale", () => {
    const form = makeForm("q1", "linear_scale", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: "5" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects empty string for required linear_scale as required error", () => {
    const form = makeForm("q1", "linear_scale", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Numeric value is required"),
      ]),
    );
  });

  it("rejects undefined for required rating", () => {
    const form = makeForm("q1", "rating", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: undefined })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Numeric value is required"),
      ]),
    );
  });

  it("rejects non-numeric string as invalid", () => {
    const form = makeForm("q1", "linear_scale", { required: false });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: "abc" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Numeric value is invalid"),
      ]),
    );
  });

  it("rejects Infinity for non-required rating", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: "Infinity" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Numeric value is invalid");
  });

  it("rejects -Infinity for non-required linear_scale", () => {
    const form = makeForm("q1", "linear_scale", {});
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: "-Infinity" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Numeric value is invalid");
  });

  it("rejects NaN string for non-required rating", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: "NaN" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Numeric value is invalid");
  });

  it("rejects Number.NaN as invalid", () => {
    const form = makeForm("q1", "linear_scale", { required: false });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: Number.NaN })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Numeric value is invalid"),
      ]),
    );
  });

  it("rejects Number.POSITIVE_INFINITY as invalid", () => {
    const form = makeForm("q1", "rating", { required: false });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: Number.POSITIVE_INFINITY })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Numeric value is invalid"),
      ]),
    );
  });

  it("rejects boolean value for non-required rating", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: true })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Numeric value is invalid");
  });

  it("rejects null for required linear_scale", () => {
    const form = makeForm("q1", "linear_scale", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: null })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Numeric value is required");
  });

  it("accepts null for non-required rating", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: null })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// short_text / long_text type validation
// ---------------------------------------------------------------------------
describe("short_text / long_text type validation", () => {
  it("rejects non-string value for required short_text", () => {
    const form = makeForm("q1", "short_text", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: 42 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Text value must be a string");
  });

  it("rejects boolean value for required long_text", () => {
    const form = makeForm("q1", "long_text", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "long_text", { value: false })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Text value must be a string");
  });

  it("rejects non-string value for non-required short_text", () => {
    const form = makeForm("q1", "short_text", {});
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: 42 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Text value must be a string");
  });

  it("accepts valid string for required short_text", () => {
    const form = makeForm("q1", "short_text", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "hello" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// radio / dropdown empty-string validation
// ---------------------------------------------------------------------------
describe("radio / dropdown empty-string validation", () => {
  it("rejects empty string for required radio", () => {
    const form = makeForm("q1", "radio", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Selection value is required");
  });

  it("rejects empty string for required dropdown", () => {
    const form = makeForm("q1", "dropdown", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "dropdown", { value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Selection value is required");
  });

  it("accepts valid value for required radio", () => {
    const form = makeForm("q1", "radio", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "option-a" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// date / time empty-string validation
// ---------------------------------------------------------------------------
describe("date / time empty-string validation", () => {
  it("rejects empty string for required date", () => {
    const form = makeForm("q1", "date", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Date/time value is required");
  });

  it("rejects empty string for required time", () => {
    const form = makeForm("q1", "time", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "time", { value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Date/time value is required");
  });

  it("accepts valid date string for required date", () => {
    const form = makeForm("q1", "date", { required: true });
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: "2024-01-15" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// radio / dropdown option membership validation
// ---------------------------------------------------------------------------
describe("radio / dropdown option membership validation", () => {
  const options = [
    { id: "opt-a", label: "A" },
    { id: "opt-b", label: "B" },
  ];

  it("accepts valid option ID for radio", () => {
    const form = makeForm("q1", "radio", { options });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "opt-a" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects invalid option ID for radio", () => {
    const form = makeForm("q1", "radio", { options });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "opt-z" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value is not a valid option");
  });

  it("rejects 'other' when allowOther is false for dropdown", () => {
    const form = makeForm("q1", "dropdown", { options, allowOther: false });
    const result = validateResponseData(
      [makeResponse("q1", "dropdown", { value: "other" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"other" is not an allowed option');
  });

  it("does not produce contradictory double-error when allowOther is false and other_value is empty for radio", () => {
    const form = makeForm("q1", "radio", { options, allowOther: false });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "other", other_value: "" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"other" is not an allowed option');
  });

  it("accepts 'other' when allowOther is true for radio", () => {
    const form = makeForm("q1", "radio", { options, allowOther: true });
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "other", other_value: "custom" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("skips option check when options list is not defined", () => {
    const form = makeForm("q1", "radio", {});
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "anything" })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkbox option membership validation
// ---------------------------------------------------------------------------
describe("checkbox option membership validation", () => {
  const options = [
    { id: "opt-a", label: "A" },
    { id: "opt-b", label: "B" },
  ];

  it("accepts valid option IDs", () => {
    const form = makeForm("q1", "checkbox", { options });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: ["opt-a", "opt-b"] })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects invalid option ID in values", () => {
    const form = makeForm("q1", "checkbox", { options });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: ["opt-a", "opt-z"] })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Value "opt-z" is not a valid option');
  });

  it("rejects 'other' when allowOther is false", () => {
    const form = makeForm("q1", "checkbox", { options, allowOther: false });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: ["opt-a", "other"] })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"other" is not an allowed option');
  });

  it("does not produce contradictory double-error when allowOther is false and other_values is empty for checkbox", () => {
    const form = makeForm("q1", "checkbox", { options, allowOther: false });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["other"],
          other_values: [],
        }),
      ],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"other" is not an allowed option');
  });

  it("accepts 'other' when allowOther is true", () => {
    const form = makeForm("q1", "checkbox", { options, allowOther: true });
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["opt-a", "other"],
          other_values: ["custom"],
        }),
      ],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects non-string values in checkbox values array", () => {
    const form = makeForm("q1", "checkbox", { options });
    const result = validateResponseData(
      [makeResponse("q1", "checkbox", { values: [123] })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Checkbox values must be strings");
  });
});

// ---------------------------------------------------------------------------
// radio / dropdown / date / time non-string value type check
// ---------------------------------------------------------------------------
describe("non-string value type rejection", () => {
  it("rejects numeric value for radio", () => {
    const form = makeForm("q1", "radio", {});
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: 42 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Selection value must be a string");
  });

  it("rejects boolean value for dropdown", () => {
    const form = makeForm("q1", "dropdown", {});
    const result = validateResponseData(
      [makeResponse("q1", "dropdown", { value: true })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Selection value must be a string");
  });

  it("rejects numeric value for date", () => {
    const form = makeForm("q1", "date", {});
    const result = validateResponseData(
      [makeResponse("q1", "date", { value: 20250101 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Date/time value must be a string");
  });

  it("rejects array value for time", () => {
    const form = makeForm("q1", "time", {});
    const result = validateResponseData(
      [makeResponse("q1", "time", { value: ["12", "30"] })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Date/time value must be a string");
  });

  it("does not reject null value for non-required radio (null is valid absence)", () => {
    const form = makeForm("q1", "radio", {});
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: null })],
      form,
    );
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allowOther enforcement without question metadata (questions = [])
// ---------------------------------------------------------------------------
describe("allowOther enforcement without question metadata", () => {
  const noQuestionsForm = { version: 1, settings: {}, questions: [] };

  it("accepts empty responses when questions list is empty", () => {
    const result = validateResponseData([], noQuestionsForm);
    expect(result.isValid).toBe(true);
  });

  it("rejects non-empty responses when questions list is empty", () => {
    const result = validateResponseData(
      [makeResponse("q1", "short_text", { value: "unexpected" })],
      noQuestionsForm,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown question ID")]),
    );
  });

  it("accepts empty responses even when questions exist (branching skips all pages)", () => {
    const form = makeForm("q1", "short_text", { required: true });
    const result = validateResponseData([], form);
    expect(result.isValid).toBe(true);
  });

  it("rejects radio 'other' with empty other_value even when questions is empty", () => {
    const result = validateResponseData(
      [makeResponse("q1", "radio", { value: "other", other_value: "" })],
      noQuestionsForm,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });

  it("rejects checkbox 'other' with empty other_values even when questions is empty", () => {
    const result = validateResponseData(
      [
        makeResponse("q1", "checkbox", {
          values: ["other"],
          other_values: [],
        }),
      ],
      noQuestionsForm,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Other value text is required"),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Rating integer validation
// ---------------------------------------------------------------------------
describe("rating integer validation", () => {
  it("rejects non-integer value for rating question", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 3.14 })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Rating value must be an integer"),
      ]),
    );
  });

  it("rejects non-integer string value for rating question", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: "3.5" })],
      form,
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Rating value must be an integer"),
      ]),
    );
  });

  it("accepts integer value for rating question", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 3 })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("accepts IEEE-754 integer-valued float for rating (e.g. 3.0)", () => {
    const form = makeForm("q1", "rating", {});
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 3.0 })],
      form,
    );
    // Number.isInteger(3.0) === true in IEEE-754
    expect(result.isValid).toBe(true);
  });

  it("allows non-integer value for linear_scale question", () => {
    const form = makeForm("q1", "linear_scale", {});
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: 3.5 })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects rating value below min", () => {
    const form = makeForm("q1", "rating", { min: 1, max: 5 });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 0 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at least 1");
  });

  it("rejects rating value above max", () => {
    const form = makeForm("q1", "rating", { min: 1, max: 5 });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 100 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at most 5");
  });

  it("accepts rating value within min/max range", () => {
    const form = makeForm("q1", "rating", { min: 1, max: 5 });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 3 })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects linear_scale value below min", () => {
    const form = makeForm("q1", "linear_scale", { min: 1, max: 10 });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: 0 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at least 1");
  });

  it("rejects linear_scale value above max", () => {
    const form = makeForm("q1", "linear_scale", { min: 1, max: 10 });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: 11 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at most 10");
  });

  it("accepts value equal to min boundary", () => {
    const form = makeForm("q1", "rating", { min: 1, max: 5 });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 1 })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("accepts value equal to max boundary", () => {
    const form = makeForm("q1", "rating", { min: 1, max: 5 });
    const result = validateResponseData(
      [makeResponse("q1", "rating", { value: 5 })],
      form,
    );
    expect(result.isValid).toBe(true);
  });

  it("enforces only min when max is not set", () => {
    const form = makeForm("q1", "linear_scale", { min: 1 });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: 0 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at least 1");
  });

  it("enforces only max when min is not set", () => {
    const form = makeForm("q1", "linear_scale", { max: 10 });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: 11 })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at most 10");
  });

  it("enforces min/max for string numeric values", () => {
    const form = makeForm("q1", "linear_scale", { min: 1, max: 10 });
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: "0" })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Value must be at least 1");
  });

  it("rejects unknown question before min/max metadata checks when questions=[]", () => {
    const noQuestionsForm = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "linear_scale", { value: 999 })],
      noQuestionsForm,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown question ID")]),
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown question type — double-error prevention
// ---------------------------------------------------------------------------
describe("unknown question type double-error prevention", () => {
  it("emits only type-mismatch error (not non-primitive error) when question is known but type differs", () => {
    const form = makeForm("q1", "short_text", {});
    const result = validateResponseData(
      [makeResponse("q1", "future_type", { value: { nested: true } })],
      form,
    );
    expect(result.isValid).toBe(false);
    // Only the type-mismatch error from the second loop, not a non-primitive error too
    const nonPrimitiveErrors = result.errors.filter((e) =>
      e.includes("Non-primitive value is not allowed"),
    );
    const typeMismatchErrors = result.errors.filter((e) =>
      e.includes("Question type mismatch"),
    );
    expect(nonPrimitiveErrors).toHaveLength(0);
    expect(typeMismatchErrors).toHaveLength(1);
  });

  it("emits non-primitive error when question is unknown (no question definition)", () => {
    const form = { version: 1, settings: {}, questions: [] };
    const result = validateResponseData(
      [makeResponse("q1", "future_type", { value: { nested: true } })],
      form,
    );
    expect(result.isValid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Non-primitive value is not allowed"),
      ),
    ).toBe(true);
  });
});

describe("R12-M2 duplicate question_id rejection", () => {
  it("rejects duplicate question_id entries in one submission", () => {
    const form = makeForm("q1", "short_text");
    const result = validateResponseData(
      [
        makeResponse("q1", "short_text", { value: "first" }),
        makeResponse("q1", "short_text", { value: "second" }),
      ],
      form,
    );

    expect(result.isValid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Duplicate question ID q1")),
    ).toBe(true);
  });
});
