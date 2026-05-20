import { describe, expect, it } from "vitest";

import {
  buildQuestionsFromPlateContent,
  buildQuestionsFromPlateContentStrict,
  PlateQuestionBuildError,
} from "../plate-question-builder";

// ---------------------------------------------------------------------------
// Helper: minimal plateContent node
// ---------------------------------------------------------------------------
function makeNode(
  type: string,
  blockId: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: `form_${type}`,
    blockId,
    children: [{ text: `Question ${blockId}` }],
    ...(validation ? { validation } : {}),
  };
}

// ---------------------------------------------------------------------------
// Basic extraction
// ---------------------------------------------------------------------------
describe("buildQuestionsFromPlateContent", () => {
  it("extracts answerable question types from plateContent JSON", () => {
    const plate = [
      makeNode("short_text", "q1"),
      makeNode("radio", "q2", { required: true, allowOther: true }),
      makeNode("checkbox", "q3", { minSelections: 1, maxSelections: 3 }),
    ];
    const questions = buildQuestionsFromPlateContent(JSON.stringify(plate));

    expect(questions).toHaveLength(3);
    expect(questions[0]).toEqual({ id: "q1", type: "short_text" });
    expect(questions[1]).toEqual({
      id: "q2",
      type: "radio",
      validation: { required: true, allowOther: true },
    });
    expect(questions[2]).toEqual({
      id: "q3",
      type: "checkbox",
      validation: { minSelections: 1, maxSelections: 3 },
    });
  });

  it("filters out non-answerable section separators", () => {
    const plate = [
      makeNode("short_text", "q1"),
      makeNode("section_separator", "sep1"),
      makeNode("date", "q2"),
    ];
    const questions = buildQuestionsFromPlateContent(JSON.stringify(plate));

    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("omits validation key when validation is empty", () => {
    const plate = [makeNode("long_text", "q1", {})];
    const questions = buildQuestionsFromPlateContent(JSON.stringify(plate));

    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual({ id: "q1", type: "long_text" });
    expect("validation" in (questions[0] as object)).toBe(false);
  });

  it("omits validation key when node has no validation property", () => {
    const plate = [makeNode("rating", "q1")];
    const questions = buildQuestionsFromPlateContent(JSON.stringify(plate));

    expect(questions).toHaveLength(1);
    expect("validation" in (questions[0] as object)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Edge cases: invalid input
  // ---------------------------------------------------------------------------
  it("returns empty array for invalid JSON", () => {
    const questions = buildQuestionsFromPlateContent("not valid json {{{");
    expect(questions).toEqual([]);
  });

  it("returns empty array when JSON is not an array", () => {
    const questions = buildQuestionsFromPlateContent(
      JSON.stringify({ type: "form_short_text" }),
    );
    expect(questions).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    const questions = buildQuestionsFromPlateContent("[]");
    expect(questions).toEqual([]);
  });

  it("throws in strict mode for invalid JSON", () => {
    expect(() =>
      buildQuestionsFromPlateContentStrict("not valid json {{{"),
    ).toThrow(PlateQuestionBuildError);
  });

  it("throws in strict mode when JSON is not an array", () => {
    expect(() =>
      buildQuestionsFromPlateContentStrict(
        JSON.stringify({ type: "form_short_text" }),
      ),
    ).toThrow(PlateQuestionBuildError);
  });

  // ---------------------------------------------------------------------------
  // Nested questions (e.g., inside columns)
  // ---------------------------------------------------------------------------
  it("extracts questions nested inside container elements", () => {
    const plate = [
      {
        type: "column_group",
        children: [
          {
            type: "column",
            children: [makeNode("short_text", "q1")],
          },
          {
            type: "column",
            children: [makeNode("dropdown", "q2", { required: true })],
          },
        ],
      },
    ];
    const questions = buildQuestionsFromPlateContent(JSON.stringify(plate));

    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({ id: "q1", type: "short_text" });
    expect(questions[1]).toEqual({
      id: "q2",
      type: "dropdown",
      validation: { required: true },
    });
  });

  // ---------------------------------------------------------------------------
  // All answerable types
  // ---------------------------------------------------------------------------
  it("handles all answerable question types", () => {
    const types = [
      "short_text",
      "long_text",
      "radio",
      "checkbox",
      "dropdown",
      "linear_scale",
      "rating",
      "choice_grid",
      "checkbox_grid",
      "date",
      "time",
    ];
    const plate = types.map((t, i) => makeNode(t, `q${i}`));
    const questions = buildQuestionsFromPlateContent(JSON.stringify(plate));

    expect(questions).toHaveLength(types.length);
    for (const [i, q] of questions.entries()) {
      expect(q.type).toBe(types[i]);
      expect(q.id).toBe(`q${i}`);
    }
  });
});
