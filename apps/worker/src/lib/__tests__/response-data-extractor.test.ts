import { describe, expect, it } from "vitest";

import {
  extractReferencedValue,
  extractReferencedValueFromJson,
  extractValueFromItem,
  safeParseResponseData,
} from "../response-data-extractor";

// ---------------------------------------------------------------------------
// extractValueFromItem
// ---------------------------------------------------------------------------
describe("extractValueFromItem", () => {
  it("returns string value as-is", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      }),
    ).toBe("hello");
  });

  it("converts numeric value to string", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "linear_scale",
        value: 5,
      }),
    ).toBe("5");
  });

  it("joins checkbox values with comma", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "b", "c"],
      }),
    ).toBe("a,b,c");
  });

  it("prefers values over value when both exist", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "checkbox",
        value: "single",
        values: ["multi-1", "multi-2"],
      }),
    ).toBe("multi-1,multi-2");
  });

  it("falls back to value when values is empty array", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "short_text",
        value: "fallback",
        values: [],
      }),
    ).toBe("fallback");
  });

  it("stringifies grid responses as JSON", () => {
    const responses = { r1: ["c1"], r2: ["c2"] };
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "choice_grid",
        responses,
      }),
    ).toBe(JSON.stringify(responses));
  });

  it("returns other_value when value is 'other' for radio", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "radio",
        value: "other",
        other_value: "custom answer",
      }),
    ).toBe("custom answer");
  });

  it("returns other_value when value is 'other' for dropdown", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "dropdown",
        value: "other",
        other_value: "dropdown custom",
      }),
    ).toBe("dropdown custom");
  });

  it("returns literal 'other' for non-supporting question types", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "short_text",
        value: "other",
        other_value: "should not be used",
      }),
    ).toBe("other");
  });

  it("returns 'other' literally when no other_value is provided", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "radio",
        value: "other",
      }),
    ).toBe("other");
  });

  it("replaces 'other' sentinel in checkbox values with other_values text", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "other", "b"],
        other_values: ["custom"],
      }),
    ).toBe("a,custom,b");
  });

  it("handles multiple 'other' entries in checkbox values", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "checkbox",
        values: ["other", "a", "other"],
        other_values: ["first", "second"],
      }),
    ).toBe("first,a,second");
  });

  it("keeps 'other' in checkbox values when other_values is empty", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "other"],
        other_values: [],
      }),
    ).toBe("a,other");
  });

  it("returns empty string for checkbox with zero selections", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "checkbox",
        values: [],
      }),
    ).toBe("");
  });

  it("returns empty string for grid with no rows answered", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "choice_grid",
        responses: {},
      }),
    ).toBe("");
  });

  it("returns empty string when responses is null (defensive; JSON.parse may yield null)", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "choice_grid",
        responses: null as unknown as Record<string, string[]>,
      }),
    ).toBe("");
  });

  it("returns empty string when item has no extractable value", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "short_text",
      }),
    ).toBe("");
  });

  it("returns empty string when value is null and no values/responses", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "short_text",
        value: null,
      }),
    ).toBe("");
  });

  it("returns empty string when all payload fields are absent", () => {
    expect(
      extractValueFromItem({
        question_id: "q1",
        question_type: "short_text",
      }),
    ).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValue — array format
// ---------------------------------------------------------------------------
describe("extractReferencedValue (array format)", () => {
  it("extracts string value from matching item", () => {
    const data = [
      { question_id: "q1", question_type: "short_text", value: "hello" },
      { question_id: "q2", question_type: "short_text", value: "world" },
    ];
    expect(extractReferencedValue(data, "q2")).toBe("world");
  });

  it("extracts numeric value from matching item", () => {
    const data = [{ question_id: "q1", question_type: "rating", value: 3 }];
    expect(extractReferencedValue(data, "q1")).toBe("3");
  });

  it("extracts checkbox values", () => {
    const data = [
      { question_id: "q1", question_type: "checkbox", values: ["x", "y"] },
    ];
    expect(extractReferencedValue(data, "q1")).toBe("x,y");
  });

  it("throws when blockId is not found in array", () => {
    const data = [
      { question_id: "q1", question_type: "short_text", value: "test" },
    ];
    expect(() => extractReferencedValue(data, "q999")).toThrow(
      "Referenced block value not found: q999",
    );
  });

  it("throws when matching item has no value", () => {
    const data = [{ question_id: "q1", question_type: "short_text" }];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block value is empty: q1",
    );
  });

  it("throws when value is null", () => {
    const data = [
      { question_id: "q1", question_type: "short_text", value: null },
    ];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block value is empty: q1",
    );
  });

  it("throws when value is empty string", () => {
    const data = [
      { question_id: "q1", question_type: "short_text", value: "" },
    ];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block value is empty: q1",
    );
  });

  it("prefers values array over value when both exist", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "checkbox",
        value: "single",
        values: ["multi-1", "multi-2"],
      },
    ];
    expect(extractReferencedValue(data, "q1")).toBe("multi-1,multi-2");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValue — edge cases
// ---------------------------------------------------------------------------
describe("extractReferencedValue (edge cases)", () => {
  it("handles empty array", () => {
    expect(() => extractReferencedValue([], "q1")).toThrow(
      "Referenced block value not found: q1",
    );
  });

  it("throws when values is empty array and no value", () => {
    const data = [{ question_id: "q1", question_type: "checkbox", values: [] }];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block value is empty: q1",
    );
  });

  it("throws when values contain non-primitive items", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", { nested: true }] as unknown as (
          | string
          | number
          | boolean
        )[],
      },
    ];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block values contain non-primitive items: q1",
    );
  });

  it("throws when values contain comma characters", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "checkbox",
        values: ["a,b", "c"],
      },
    ];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block values contain comma characters that would produce ambiguous joined output: q1",
    );
  });

  it("throws when other_values contain comma characters", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "other"],
        other_values: ["Smith, John"],
      },
    ];
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block other_values contain comma characters that would produce ambiguous joined output: q1",
    );
  });

  it("does not throw for comma in other_values when question_type is not checkbox", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "radio" as const,
        values: ["a", "b"],
        other_values: ["Smith, John"],
      },
    ];
    // other_values is ignored for non-checkbox types, so no comma error should be thrown
    expect(extractReferencedValue(data, "q1")).toBe("a,b");
  });

  it("does not throw for comma in other_values when checkbox values is empty", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "checkbox" as const,
        values: [] as string[],
        other_values: ["Smith, John"],
      },
    ];
    // values is empty so other_values will not be used — no comma error
    expect(() => extractReferencedValue(data, "q1")).toThrow(
      "Referenced block value is empty: q1",
    );
  });

  it("does not throw for comma in other_values when no 'other' sentinel in values (stale state)", () => {
    const data = [
      {
        question_id: "q1",
        question_type: "checkbox" as const,
        values: ["a", "b"],
        other_values: ["Smith, John"],
      },
    ];
    // No "other" sentinel in values, so other_values is never read — comma should not cause rejection
    expect(extractReferencedValue(data, "q1")).toBe("a,b");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson", () => {
  it("resolves value from valid array-format JSON", () => {
    const json = JSON.stringify([
      { question_id: "q1", question_type: "short_text", value: "hello" },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("hello");
  });

  it("throws when array items fail schema (e.g. numeric question_id)", () => {
    const json = JSON.stringify([
      { question_id: 123, question_type: "short_text", value: "x" },
    ]);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "array items failed schema validation",
    );
  });

  it("throws on object-format JSON (no longer supported)", () => {
    const json = JSON.stringify({ q1: "value" });
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format",
    );
  });

  it("throws on malformed JSON", () => {
    expect(() =>
      extractReferencedValueFromJson("{invalid", "q1", "resp-1"),
    ).toThrow("not valid JSON");
  });

  it("throws on null JSON value", () => {
    expect(() =>
      extractReferencedValueFromJson("null", "q1", "resp-1"),
    ).toThrow("Invalid responseDataJson format");
  });

  it("throws on scalar JSON value", () => {
    expect(() =>
      extractReferencedValueFromJson('"just a string"', "q1", "resp-1"),
    ).toThrow("Invalid responseDataJson format");
  });
});

// ---------------------------------------------------------------------------
// safeParseResponseData
// ---------------------------------------------------------------------------
describe("safeParseResponseData", () => {
  it("normalizes array-format response data into a question_id keyed map", () => {
    const json = JSON.stringify([
      {
        question_id: "name",
        question_type: "short_text",
        value: "Alice",
      },
      {
        question_id: "interests",
        question_type: "checkbox",
        values: ["docs", "api"],
      },
      {
        question_id: "matrix",
        question_type: "choice_grid",
        responses: { row1: "yes" },
      },
    ]);

    expect(safeParseResponseData(json, "resp-1")).toEqual({
      name: "Alice",
      interests: "docs,api",
      matrix: JSON.stringify({ row1: "yes" }),
    });
  });

  it("keeps legacy object-map response data for backward compatibility", () => {
    expect(
      safeParseResponseData(JSON.stringify({ q1: "legacy" }), "resp-1"),
    ).toEqual({ q1: "legacy" });
  });

  it("returns null when array-format response data fails schema validation", () => {
    expect(
      safeParseResponseData(
        JSON.stringify([{ question_id: 123, question_type: "short_text" }]),
        "resp-1",
      ),
    ).toBeNull();
  });
});
