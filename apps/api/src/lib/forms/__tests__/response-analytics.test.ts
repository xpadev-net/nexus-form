import { describe, expect, it } from "vitest";
import {
  aggregateAllBlocks,
  aggregateAllBlocksInBatches,
} from "../response-analytics";

const blocks = [
  {
    blockId: "rating-block",
    type: "rating",
    content: {
      title: "Rating",
      validation: { maxRating: 5 },
    },
  },
  {
    blockId: "text-block",
    type: "short_text",
    content: {
      title: "Comment",
      validation: {},
    },
  },
  {
    blockId: "choice-block",
    type: "radio",
    content: {
      title: "Choice",
      validation: {
        options: [
          { id: "choice-a", label: "Same label" },
          { id: "choice-b", label: "Same label" },
        ],
      },
    },
  },
  {
    blockId: "grid-block",
    type: "choice_grid",
    content: {
      title: "Grid",
      validation: {
        rows: [
          { id: "row-a", label: "Same row" },
          { id: "row-b", label: "Same row" },
        ],
        columns: [
          { id: "column-a", label: "Column A" },
          { id: "column-b", label: "Column B" },
        ],
      },
    },
  },
  {
    blockId: "date-block",
    type: "date",
    content: {
      title: "Date",
      validation: {},
    },
  },
  {
    blockId: "time-block",
    type: "time",
    content: {
      title: "Time",
      validation: {},
    },
  },
];

function responseRow(
  id: string,
  rating: number,
  text: string,
  choice = "choice-a",
): {
  id: string;
  submittedAt: Date;
  responseDataJson: string;
} {
  return {
    id,
    submittedAt: new Date(`2026-05-17T00:00:0${rating}.000Z`),
    responseDataJson: JSON.stringify([
      {
        question_id: "rating-block",
        question_type: "rating",
        value: rating,
      },
      {
        question_id: "text-block",
        question_type: "short_text",
        value: text,
      },
      {
        question_id: "choice-block",
        question_type: "radio",
        value: choice,
      },
      {
        question_id: "grid-block",
        question_type: "choice_grid",
        responses: {
          "row-a": "column-a",
          "row-b": "column-b",
        },
      },
      {
        question_id: "date-block",
        question_type: "date",
        value: `2026-05-${String(rating).padStart(2, "0")}`,
      },
      {
        question_id: "time-block",
        question_type: "time",
        value: `09:${String(rating).padStart(2, "0")}`,
      },
    ]),
  };
}

function formatCursorMarker(row: {
  id: string;
  submittedAt: Date | string;
}): string {
  return `${String(row.submittedAt)}:${row.id}`;
}

function loadByCursor<T extends { id: string; submittedAt: Date | string }>(
  rows: T[],
  seenCursors: string[] = [],
): (
  cursor: { id: string; submittedAt: Date | string } | undefined,
  limit: number,
) => Promise<T[]> {
  return async (cursor, limit) => {
    seenCursors.push(cursor ? formatCursorMarker(cursor) : "START");
    const cursorTime = cursor
      ? cursor.submittedAt instanceof Date
        ? cursor.submittedAt.valueOf()
        : new Date(cursor.submittedAt).valueOf()
      : undefined;
    const start = cursor
      ? rows.findIndex(
          (row) =>
            row.id === cursor.id &&
            (row.submittedAt instanceof Date
              ? row.submittedAt.valueOf()
              : new Date(row.submittedAt).valueOf()) === cursorTime,
        ) + 1
      : 0;
    return rows.slice(start, start + limit);
  };
}

describe("aggregateAllBlocksInBatches", () => {
  it("aggregates saved responseDataJson values across major question payload shapes", async () => {
    const fixtureBlocks = [
      {
        blockId: "short-text",
        type: "short_text",
        content: { title: "氏名", validation: {} },
      },
      {
        blockId: "radio",
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
        blockId: "checkbox",
        type: "checkbox",
        content: {
          title: "興味",
          validation: {
            options: [
              { id: "typescript", label: "TypeScript" },
              { id: "react", label: "React" },
            ],
          },
        },
      },
      {
        blockId: "choice-grid",
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
        blockId: "checkbox-grid",
        type: "checkbox_grid",
        content: {
          title: "対応可能時間",
          validation: {
            rows: [{ id: "tuesday", label: "火曜" }],
            columns: [
              { id: "morning", label: "午前" },
              { id: "evening", label: "夜" },
            ],
          },
        },
      },
      {
        blockId: "rating",
        type: "rating",
        content: { title: "満足度", validation: { maxRating: 5 } },
      },
      {
        blockId: "date",
        type: "date",
        content: { title: "希望日", validation: {} },
      },
      {
        blockId: "time",
        type: "time",
        content: { title: "希望時刻", validation: {} },
      },
    ];
    const responses = [
      {
        id: "response-1",
        submittedAt: new Date("2026-05-17T01:00:00.000Z"),
        responseDataJson: JSON.stringify([
          {
            question_id: "short-text",
            question_type: "short_text",
            value: "山田 太郎",
          },
          {
            question_id: "radio",
            question_type: "radio",
            value: "morning",
          },
          {
            question_id: "checkbox",
            question_type: "checkbox",
            values: ["typescript", "react"],
          },
          {
            question_id: "choice-grid",
            question_type: "choice_grid",
            responses: { monday: "morning" },
          },
          {
            question_id: "checkbox-grid",
            question_type: "checkbox_grid",
            responses: { tuesday: ["morning", "evening"] },
          },
          {
            question_id: "rating",
            question_type: "rating",
            value: 5,
          },
          {
            question_id: "date",
            question_type: "date",
            value: "2026-05-20",
          },
          {
            question_id: "time",
            question_type: "time",
            value: "09:30",
          },
        ]),
      },
    ];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      fixtureBlocks,
      loadByCursor(responses),
      { batchSize: 1 },
    );

    expect(actual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_id: "short-text",
          total_responses: 1,
          analytics_data: expect.objectContaining({
            responses: [
              expect.objectContaining({
                response_id: "response-1",
                value: "山田 太郎",
              }),
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "radio",
          analytics_data: expect.objectContaining({
            options: [
              { label: "午前", count: 1, percentage: 100 },
              { label: "午後", count: 0, percentage: 0 },
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "checkbox",
          analytics_data: expect.objectContaining({
            options: [
              { label: "TypeScript", count: 1, percentage: 100 },
              { label: "React", count: 1, percentage: 100 },
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "choice-grid",
          analytics_data: expect.objectContaining({
            row_analytics: [
              {
                row_label: "月曜",
                column_counts: [{ column_id: "morning", count: 1 }],
              },
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "checkbox-grid",
          analytics_data: expect.objectContaining({
            row_analytics: [
              {
                row_label: "火曜",
                column_counts: [
                  { column_id: "morning", count: 1 },
                  { column_id: "evening", count: 1 },
                ],
              },
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "rating",
          analytics_data: expect.objectContaining({
            options: expect.arrayContaining([
              { label: "5", count: 1, percentage: 100 },
            ]),
          }),
        }),
        expect.objectContaining({
          block_id: "date",
          analytics_data: expect.objectContaining({
            distribution: [{ date: "2026-05-20", count: 1, percentage: 100 }],
          }),
        }),
        expect.objectContaining({
          block_id: "time",
          analytics_data: expect.objectContaining({
            distribution: [{ time: "09:30", count: 1, percentage: 100 }],
          }),
        }),
      ]),
    );
  });

  it("resolves grid response ids and legacy labels without breaking on invalid payloads", async () => {
    const fixtureBlocks = [
      {
        blockId: "choice-grid-single",
        type: "choice_grid",
        content: {
          title: "1x1 Grid",
          validation: {
            rows: [{ id: "row-single", label: "単一行" }],
            columns: [{ id: "col-single", label: "単一列" }],
          },
        },
      },
      {
        blockId: "choice-grid",
        type: "choice_grid",
        content: {
          title: "Choice Grid",
          validation: {
            rows: [
              { id: "row-a", label: "月曜" },
              { id: "row-b", label: "火曜" },
            ],
            columns: [
              { id: "col-morning", label: "午前" },
              { id: "col-evening", label: "夜" },
            ],
          },
        },
      },
      {
        blockId: "checkbox-grid",
        type: "checkbox_grid",
        content: {
          title: "Checkbox Grid",
          validation: {
            rows: [
              { id: "row-a", label: "月曜" },
              { id: "row-b", label: "火曜" },
            ],
            columns: [
              { id: "col-morning", label: "午前" },
              { id: "col-evening", label: "夜" },
            ],
          },
        },
      },
    ];
    const responses = [
      {
        id: "response-1",
        submittedAt: new Date("2026-05-17T01:00:00.000Z"),
        responseDataJson: JSON.stringify([
          {
            question_id: "choice-grid-single",
            question_type: "choice_grid",
            responses: { "row-single": "col-single" },
          },
          {
            question_id: "choice-grid",
            question_type: "choice_grid",
            responses: { "row-a": "col-morning", "row-b": "" },
          },
          {
            question_id: "checkbox-grid",
            question_type: "checkbox_grid",
            responses: {
              "row-a": ["col-morning"],
              "row-b": ["col-morning", "col-evening"],
            },
          },
        ]),
      },
      {
        id: "legacy-label-response",
        submittedAt: new Date("2026-05-17T01:01:00.000Z"),
        responseDataJson: JSON.stringify([
          {
            question_id: "choice-grid",
            question_type: "choice_grid",
            responses: { 月曜: "夜" },
          },
          {
            question_id: "checkbox-grid",
            question_type: "checkbox_grid",
            responses: { 火曜: ["午前", "夜"] },
          },
        ]),
      },
      {
        id: "invalid-grid-response",
        submittedAt: new Date("2026-05-17T01:02:00.000Z"),
        responseDataJson: JSON.stringify([
          {
            question_id: "choice-grid",
            question_type: "choice_grid",
            responses: {
              "unknown-row": "col-morning",
              "row-a": ["col-morning"],
            },
          },
          {
            question_id: "checkbox-grid",
            question_type: "checkbox_grid",
            responses: { "row-a": "col-morning", "row-b": ["unknown-column"] },
          },
        ]),
      },
    ];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      fixtureBlocks,
      loadByCursor(responses),
      { batchSize: 2 },
    );

    expect(actual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_id: "choice-grid-single",
          total_responses: 1,
          analytics_data: expect.objectContaining({
            rows: [{ id: "row-single", label: "単一行" }],
            columns: [{ id: "col-single", label: "単一列" }],
            row_analytics: [
              {
                row_label: "単一行",
                column_counts: [{ column_id: "col-single", count: 1 }],
              },
            ],
            invalid_responses: [],
          }),
        }),
        expect.objectContaining({
          block_id: "choice-grid",
          total_responses: 3,
          analytics_data: expect.objectContaining({
            row_analytics: [
              {
                row_label: "月曜",
                column_counts: [
                  { column_id: "col-morning", count: 1 },
                  { column_id: "col-evening", count: 1 },
                ],
              },
              {
                row_label: "火曜",
                column_counts: [
                  { column_id: "col-morning", count: 0 },
                  { column_id: "col-evening", count: 0 },
                ],
              },
            ],
            column_analytics: [
              {
                column_id: "col-morning",
                column_label: "午前",
                row_counts: [
                  { row_label: "月曜", count: 1 },
                  { row_label: "火曜", count: 0 },
                ],
              },
              {
                column_id: "col-evening",
                column_label: "夜",
                row_counts: [
                  { row_label: "月曜", count: 1 },
                  { row_label: "火曜", count: 0 },
                ],
              },
            ],
            invalid_responses: [
              {
                response_id: "invalid-grid-response",
                reason: 'Unknown grid row "unknown-row"',
              },
              {
                response_id: "invalid-grid-response",
                reason:
                  'Choice grid row "月曜" must contain a single selection',
              },
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "checkbox-grid",
          total_responses: 3,
          analytics_data: expect.objectContaining({
            row_analytics: [
              {
                row_label: "月曜",
                column_counts: [
                  { column_id: "col-morning", count: 1 },
                  { column_id: "col-evening", count: 0 },
                ],
              },
              {
                row_label: "火曜",
                column_counts: [
                  { column_id: "col-morning", count: 2 },
                  { column_id: "col-evening", count: 2 },
                ],
              },
            ],
            invalid_responses: [
              {
                response_id: "invalid-grid-response",
                reason:
                  'Checkbox grid row "月曜" must contain selection arrays',
              },
              {
                response_id: "invalid-grid-response",
                reason: 'Unknown grid column "unknown-column" for row "火曜"',
              },
            ],
          }),
        }),
      ]),
    );
  });

  it("keeps R26-M1 S19/S20 grid analytics renderable for choice and checkbox grids", async () => {
    const fixtureBlocks = [
      {
        blockId: "s19-choice-grid",
        type: "choice_grid",
        content: {
          title: "S19 choice grid",
          validation: {
            rows: [
              { id: "row-a", label: "初日" },
              { id: "row-b", label: "二日目" },
            ],
            columns: [
              { id: "available", label: "参加可" },
              { id: "unavailable", label: "不可" },
            ],
          },
        },
      },
      {
        blockId: "s20-checkbox-grid",
        type: "checkbox_grid",
        content: {
          title: "S20 checkbox grid",
          validation: {
            rows: [
              { id: "row-a", label: "午前" },
              { id: "row-b", label: "午後" },
            ],
            columns: [
              { id: "remote", label: "リモート" },
              { id: "onsite", label: "会場" },
            ],
          },
        },
      },
    ];
    const responses = [
      {
        id: "response-s19-s20",
        submittedAt: new Date("2026-06-04T01:00:00.000Z"),
        responseDataJson: JSON.stringify([
          {
            question_id: "s19-choice-grid",
            question_type: "choice_grid",
            responses: {
              "row-a": "available",
              "row-b": "unavailable",
            },
          },
          {
            question_id: "s20-checkbox-grid",
            question_type: "checkbox_grid",
            responses: {
              "row-a": ["remote", "onsite"],
              "row-b": ["remote"],
            },
          },
        ]),
      },
    ];

    const actual = await aggregateAllBlocksInBatches(
      "form-r26-grid",
      fixtureBlocks,
      loadByCursor(responses),
      { batchSize: 1 },
    );

    expect(actual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_id: "s19-choice-grid",
          block_type: "choice_grid",
          total_responses: 1,
          analytics_data: expect.objectContaining({
            row_analytics: [
              {
                row_label: "初日",
                column_counts: [
                  { column_id: "available", count: 1 },
                  { column_id: "unavailable", count: 0 },
                ],
              },
              {
                row_label: "二日目",
                column_counts: [
                  { column_id: "available", count: 0 },
                  { column_id: "unavailable", count: 1 },
                ],
              },
            ],
            invalid_responses: [],
          }),
        }),
        expect.objectContaining({
          block_id: "s20-checkbox-grid",
          block_type: "checkbox_grid",
          total_responses: 1,
          analytics_data: expect.objectContaining({
            row_analytics: [
              {
                row_label: "午前",
                column_counts: [
                  { column_id: "remote", count: 1 },
                  { column_id: "onsite", count: 1 },
                ],
              },
              {
                row_label: "午後",
                column_counts: [
                  { column_id: "remote", count: 1 },
                  { column_id: "onsite", count: 0 },
                ],
              },
            ],
            invalid_responses: [],
          }),
        }),
      ]),
    );
  });

  it("returns empty analytics for configured blocks when there are no responses", async () => {
    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor([]),
      { batchSize: 2 },
    );

    expect(actual).toEqual(aggregateAllBlocks("form-1", blocks, []));
    expect(actual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_id: "choice-block",
          total_responses: 0,
          response_rate: 0,
          analytics_data: expect.objectContaining({
            total_responses: 0,
            options: [
              { label: "Same label", count: 0, percentage: 0 },
              { label: "Same label", count: 0, percentage: 0 },
            ],
          }),
        }),
        expect.objectContaining({
          block_id: "text-block",
          total_responses: 0,
          response_rate: 0,
          analytics_data: {
            total_responses: 0,
            responses: [],
            word_count_stats: undefined,
          },
        }),
      ]),
    );
  });

  it("matches the non-batched aggregate across multiple response batches", async () => {
    const responses = [
      responseRow("response-1", 1, "a"),
      responseRow("response-2", 2, "bb"),
      responseRow("response-3", 2, "ccc", "choice-b"),
      responseRow("response-4", 5, "dddd", "choice-b"),
    ];
    const expected = aggregateAllBlocks("form-1", blocks, responses);
    const seenCursors: string[] = [];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor(responses, seenCursors),
      { batchSize: 2 },
    );
    const secondResponse = responses[1];
    const fourthResponse = responses[3];
    if (!secondResponse || !fourthResponse) {
      throw new Error("test fixture is missing expected cursor rows");
    }

    expect(seenCursors).toEqual([
      "START",
      formatCursorMarker(secondResponse),
      formatCursorMarker(fourthResponse),
    ]);
    expect(actual).toEqual(expected);
  });

  it("uses the composite submittedAt and id cursor when timestamps tie", async () => {
    const submittedAt = new Date("2026-05-17T01:00:00.000Z");
    const responses = [
      { ...responseRow("response-c", 1, "a"), submittedAt },
      { ...responseRow("response-b", 2, "bb"), submittedAt },
      { ...responseRow("response-a", 3, "ccc"), submittedAt },
    ];
    const expected = aggregateAllBlocks("form-1", blocks, responses);
    const seenCursors: string[] = [];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor(responses, seenCursors),
      { batchSize: 2 },
    );
    const secondResponse = responses[1];
    if (!secondResponse) {
      throw new Error("test fixture is missing expected cursor row");
    }

    expect(seenCursors).toEqual(["START", formatCursorMarker(secondResponse)]);
    expect(actual).toEqual(expected);
  });

  it("keeps legacy semantics for invalid JSON and duplicate labels", async () => {
    const responses = [
      responseRow("response-1", 1, "a"),
      {
        id: "invalid-response",
        submittedAt: new Date("2026-05-17T00:00:05.000Z"),
        responseDataJson: "{",
      },
      responseRow("response-2", 2, "bb", "choice-b"),
    ];
    const expected = aggregateAllBlocks("form-1", blocks, responses);

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor(responses),
      { batchSize: 1 },
    );

    expect(actual).toEqual(expected);
  });

  it("recalculates text averages from exact lengths across rounded batches", async () => {
    const responses = [
      responseRow("response-1", 1, "a"),
      responseRow("response-2", 2, "bb"),
      responseRow("response-3", 3, "bb"),
      responseRow("response-4", 4, "bb"),
      responseRow("response-5", 5, "bb"),
      responseRow("response-6", 1, "bb"),
    ];
    const expected = aggregateAllBlocks("form-1", blocks, responses);

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor(responses),
      { batchSize: 3 },
    );

    expect(actual).toEqual(expected);
  });

  it("caps detail response lists while preserving aggregate counts", async () => {
    const responses = [
      responseRow("response-1", 1, "a"),
      responseRow("response-2", 2, "bb"),
      responseRow("response-3", 3, "ccc"),
    ];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor(responses),
      { batchSize: 1, detailResponseLimit: 2 },
    );

    const textBlock = actual.find((block) => block.block_id === "text-block");
    expect(textBlock?.total_responses).toBe(3);
    expect(textBlock?.analytics_data).toMatchObject({
      total_responses: 3,
      responses: [
        {
          response_id: "response-1",
          value: "a",
        },
        {
          response_id: "response-2",
          value: "bb",
        },
      ],
      word_count_stats: {
        average: 2,
        min: 1,
        max: 3,
      },
    });
  });

  it("caps detail response lists even when the first batch exceeds the cap", async () => {
    const responses = [
      responseRow("response-1", 1, "a"),
      responseRow("response-2", 2, "bb"),
      responseRow("response-3", 3, "ccc"),
    ];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      loadByCursor(responses),
      { batchSize: 10, detailResponseLimit: 2 },
    );

    const textBlock = actual.find((block) => block.block_id === "text-block");
    expect(textBlock?.analytics_data).toMatchObject({
      total_responses: 3,
      responses: [
        {
          response_id: "response-1",
          value: "a",
        },
        {
          response_id: "response-2",
          value: "bb",
        },
      ],
      word_count_stats: {
        average: 2,
        min: 1,
        max: 3,
      },
    });

    const dateBlock = actual.find((block) => block.block_id === "date-block");
    expect(dateBlock?.analytics_data).toMatchObject({
      total_responses: 3,
      distribution: [
        { date: "2026-05-01", count: 1 },
        { date: "2026-05-02", count: 1 },
        { date: "2026-05-03", count: 1 },
      ],
      responses: [
        { response_id: "response-1", date: "2026-05-01" },
        { response_id: "response-2", date: "2026-05-02" },
      ],
    });

    const timeBlock = actual.find((block) => block.block_id === "time-block");
    expect(timeBlock?.analytics_data).toMatchObject({
      total_responses: 3,
      distribution: [
        { time: "09:01", count: 1 },
        { time: "09:02", count: 1 },
        { time: "09:03", count: 1 },
      ],
      responses: [
        { response_id: "response-1", time: "09:01" },
        { response_id: "response-2", time: "09:02" },
      ],
    });
  });
});
