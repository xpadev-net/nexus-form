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
