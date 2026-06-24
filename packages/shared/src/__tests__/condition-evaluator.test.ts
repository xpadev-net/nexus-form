import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../forms/condition-evaluator";

describe("condition evaluator", () => {
  it("checkbox responses can be compared with a single selected option ID", () => {
    expect(
      evaluateCondition(
        { question_id: "features", operator: "equals", value: "export" },
        {
          questionId: "features",
          responses: { features: ["export", "share"] },
        },
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { question_id: "features", operator: "not_equals", value: "export" },
        {
          questionId: "features",
          responses: { features: ["export", "share"] },
        },
      ),
    ).toBe(false);
  });

  it("numeric candidate arrays work with includes operators", () => {
    expect(
      evaluateCondition(
        { question_id: "scores", operator: "includes_all", value: [2, 4] },
        { questionId: "scores", responses: { scores: [2, 3, 4] } },
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { question_id: "scores", operator: "includes_any", value: [5, 6] },
        { questionId: "scores", responses: { scores: [2, 3, 4] } },
      ),
    ).toBe(false);
  });

  it("single-answer responses can be matched against includes candidate arrays", () => {
    expect(
      evaluateCondition(
        {
          question_id: "color",
          operator: "includes_any",
          value: ["red", "blue"],
        },
        { questionId: "color", responses: { color: "red" } },
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          question_id: "color",
          operator: "includes_all",
          value: ["red", "blue"],
        },
        { questionId: "color", responses: { color: "red" } },
      ),
    ).toBe(false);

    expect(
      evaluateCondition(
        { question_id: "score", operator: "includes_any", value: [3, 5] },
        { questionId: "score", responses: { score: 5 } },
      ),
    ).toBe(true);
  });

  it("empty includes_all conditions do not match every answered array", () => {
    expect(
      evaluateCondition(
        { question_id: "features", operator: "includes_all", value: [] },
        { questionId: "features", responses: { features: ["export"] } },
      ),
    ).toBe(false);
  });
});
