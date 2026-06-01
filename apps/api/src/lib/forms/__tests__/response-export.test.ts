import { describe, expect, it } from "vitest";
import {
  buildResponseExportRecords,
  formatRecordsToCsv,
} from "../response-export";

const submittedAt = new Date("2026-05-17T01:00:00.000Z");

const formBlocks = [
  {
    blockId: "name-block",
    category: "question",
    type: "short_text",
    content: { title: "氏名", validation: {} },
  },
  {
    blockId: "choice-block",
    category: "question",
    type: "radio",
    content: {
      title: "希望枠",
      validation: {
        options: [
          { id: "morning", label: "午前" },
          { id: "afternoon", label: "午後" },
        ],
      },
    },
  },
  {
    blockId: "checkbox-block",
    category: "question",
    type: "checkbox",
    content: { title: "興味", validation: {} },
  },
  {
    blockId: "grid-block",
    category: "question",
    type: "choice_grid",
    content: {
      title: "参加可能日",
      validation: {
        rows: [{ id: "monday", label: "月曜" }],
        columns: [{ id: "morning", label: "午前" }],
      },
    },
  },
  {
    blockId: "rating-block",
    category: "question",
    type: "rating",
    content: { title: "満足度", validation: { maxRating: 5 } },
  },
  {
    blockId: "missing-block",
    category: "question",
    type: "short_text",
    content: { title: "未回答", validation: {} },
  },
  {
    blockId: "system-block",
    category: "system",
    type: "section_separator",
    content: { title: "区切り", validation: {} },
  },
];

const blockTitleMap = new Map(
  formBlocks.map((block) => [
    block.blockId,
    typeof block.content === "object" && block.content !== null
      ? String((block.content as { title?: unknown }).title ?? block.blockId)
      : block.blockId,
  ]),
);

describe("response export", () => {
  it("reflects saved responseDataJson values in export records and CSV output", () => {
    const { records, fingerprintComponents } = buildResponseExportRecords(
      "form-1",
      [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: JSON.stringify([
            {
              question_id: "name-block",
              question_type: "short_text",
              value: "山田 太郎",
            },
            {
              question_id: "choice-block",
              question_type: "radio",
              value: "morning",
            },
            {
              question_id: "checkbox-block",
              question_type: "checkbox",
              values: ["TypeScript", "React"],
            },
            {
              question_id: "grid-block",
              question_type: "choice_grid",
              responses: { monday: "morning" },
            },
            {
              question_id: "rating-block",
              question_type: "rating",
              value: 5,
            },
          ]),
          respondentUuid: "respondent-1",
          submittedAt,
          updatedAt: null,
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
          fingerprintDetails: [],
        },
      ],
      formBlocks,
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.component_columns).toEqual([
      {
        block_id: "name-block",
        block_type: "short_text",
        question_title: undefined,
        value: "山田 太郎",
      },
      {
        block_id: "choice-block",
        block_type: "radio",
        question_title: undefined,
        value: "morning",
      },
      {
        block_id: "checkbox-block",
        block_type: "checkbox",
        question_title: undefined,
        value: ["TypeScript", "React"],
      },
      {
        block_id: "grid-block",
        block_type: "choice_grid",
        question_title: undefined,
        value: { monday: "morning" },
      },
      {
        block_id: "rating-block",
        block_type: "rating",
        question_title: undefined,
        value: 5,
      },
      {
        block_id: "missing-block",
        block_type: "short_text",
        question_title: undefined,
        value: null,
      },
    ]);

    const csv = formatRecordsToCsv(
      records,
      fingerprintComponents,
      blockTitleMap,
    );

    expect(csv.split("\n")[0]).toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","氏名","希望枠","興味","参加可能日","満足度","未回答"',
    );
    expect(csv.split("\n")[1]).toBe(
      '"response-1","respondent-1","2026-05-17T01:00:00.000Z","","JP","","1.0000","山田 太郎","morning","TypeScript, React","{""monday"":""morning""}","5",""',
    );
    expect(csv).not.toContain("区切り");
  });

  it("returns a header row when CSV output has no records", () => {
    const questionTitleMap = new Map([
      ["name-block", "氏名"],
      ["choice-block", "希望枠"],
    ]);

    expect(formatRecordsToCsv([], new Set(), questionTitleMap)).toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","氏名","希望枠"',
    );
  });
});
