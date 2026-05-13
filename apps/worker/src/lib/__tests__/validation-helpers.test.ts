import { describe, expect, it } from "vitest";

import { extractReferencedValueFromJson } from "../response-data-extractor";

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson — array format (new)
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson (array format)", () => {
  it("extracts value from valid array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("hello");
  });

  it("extracts checkbox values from array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "b"],
      },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("a,b");
  });

  it("throws when array items fail schema validation (e.g. numeric question_id)", () => {
    const json = JSON.stringify([
      { question_id: 123, question_type: "radio", value: "opt-a" },
    ]);
    expect(() => extractReferencedValueFromJson(json, "123", "resp-1")).toThrow(
      "responseDataJson array items failed schema validation for response resp-1",
    );
  });

  it("throws when block not found in array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      },
    ]);
    expect(() =>
      extractReferencedValueFromJson(json, "q999", "resp-1"),
    ).toThrow("Referenced block value not found: q999");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson — error cases
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson (error cases)", () => {
  it("throws for malformed JSON", () => {
    expect(() =>
      extractReferencedValueFromJson("{invalid", "q1", "resp-1"),
    ).toThrow("responseDataJson is not valid JSON for response resp-1");
  });

  it("throws when rawData is not an array", () => {
    const json = JSON.stringify({ q1: "value" });
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for non-object, non-array rawData (string)", () => {
    const json = JSON.stringify("just a string");
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for non-object, non-array rawData (number)", () => {
    const json = JSON.stringify(42);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for null rawData", () => {
    const json = JSON.stringify(null);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });
});
