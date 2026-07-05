import type { ValidatorQuestion } from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import {
  addDisplayLabelsToResponseDataJson,
  buildResponseLabelLookupFromQuestions,
} from "../response-choice-labels";

describe("response choice display labels", () => {
  it("adds display labels while preserving stored internal IDs", () => {
    const questions: ValidatorQuestion[] = [
      {
        id: "company-type",
        type: "radio",
        validation: {
          options: [
            { id: "corp", label: "法人" },
            { id: "blank", label: "" },
          ],
        },
      },
      {
        id: "preferred-tool",
        type: "dropdown",
        validation: {
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "react", label: "React" },
          ],
          allowOther: true,
          otherLabel: "自由記述",
        },
      },
      {
        id: "interests",
        type: "checkbox",
        validation: {
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "react", label: "React" },
          ],
          allowOther: true,
          otherLabel: "その他の興味",
        },
      },
      {
        id: "company-grid",
        type: "choice_grid",
        validation: {
          rows: [
            { id: "contract", label: "契約種別" },
            { id: "billing", label: "請求先" },
          ],
          columns: [{ id: "corp", label: "法人" }],
        },
      },
      {
        id: "availability-grid",
        type: "checkbox_grid",
        validation: {
          rows: [
            { id: "monday", label: "月曜" },
            { id: "tuesday", label: "火曜" },
            { id: "wednesday", label: "水曜" },
          ],
          columns: [
            { id: "morning", label: "午前" },
            { id: "evening", label: "夜" },
          ],
        },
      },
    ];

    const responseDataJson = JSON.stringify([
      {
        question_id: "company-type",
        question_type: "radio",
        value: "corp",
      },
      {
        question_id: "company-type",
        question_type: "radio",
        value: "blank",
      },
      {
        question_id: "unknown-choice",
        question_type: "radio",
        value: "legacy-id",
      },
      {
        question_id: "preferred-tool",
        question_type: "dropdown",
        value: "other",
        other_value: "Vue",
      },
      {
        question_id: "interests",
        question_type: "checkbox",
        values: ["ts", "other"],
        other_values: ["アクセシビリティ"],
      },
      {
        question_id: "company-grid",
        question_type: "choice_grid",
        responses: { contract: "corp" },
      },
      {
        question_id: "availability-grid",
        question_type: "checkbox_grid",
        responses: { monday: ["morning", "evening"], tuesday: [] },
      },
    ]);

    const enriched = addDisplayLabelsToResponseDataJson(
      responseDataJson,
      buildResponseLabelLookupFromQuestions(questions),
    );

    expect(JSON.parse(enriched ?? "[]")).toEqual([
      {
        question_id: "company-type",
        question_type: "radio",
        value: "corp",
        display_value: "法人",
      },
      {
        question_id: "company-type",
        question_type: "radio",
        value: "blank",
        display_value: "（空の選択肢）",
      },
      {
        question_id: "unknown-choice",
        question_type: "radio",
        value: "legacy-id",
      },
      {
        question_id: "preferred-tool",
        question_type: "dropdown",
        value: "other",
        other_value: "Vue",
        display_value: "自由記述",
      },
      {
        question_id: "interests",
        question_type: "checkbox",
        values: ["ts", "other"],
        other_values: ["アクセシビリティ"],
        display_values: ["TypeScript", "その他の興味"],
      },
      {
        question_id: "company-grid",
        question_type: "choice_grid",
        responses: { contract: "corp" },
        display_value: "契約種別: 法人\n請求先: 未回答",
      },
      {
        question_id: "availability-grid",
        question_type: "checkbox_grid",
        responses: { monday: ["morning", "evening"], tuesday: [] },
        display_value: "月曜: 午前, 夜\n火曜: 未回答\n水曜: 未回答",
      },
    ]);
  });
});
