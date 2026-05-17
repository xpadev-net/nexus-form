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
    ]),
  };
}

describe("aggregateAllBlocksInBatches", () => {
  it("matches the non-batched aggregate across multiple response batches", async () => {
    const responses = [
      responseRow("response-1", 1, "a"),
      responseRow("response-2", 2, "bb"),
      responseRow("response-3", 2, "ccc", "choice-b"),
      responseRow("response-4", 5, "dddd", "choice-b"),
    ];
    const expected = aggregateAllBlocks("form-1", blocks, responses);
    const loadedOffsets: number[] = [];

    const actual = await aggregateAllBlocksInBatches(
      "form-1",
      blocks,
      async (offset, limit) => {
        loadedOffsets.push(offset);
        return responses.slice(offset, offset + limit);
      },
      { batchSize: 2 },
    );

    expect(loadedOffsets).toEqual([0, 2, 4]);
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
      async (offset, limit) => responses.slice(offset, offset + limit),
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
      async (offset, limit) => responses.slice(offset, offset + limit),
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
      async (offset, limit) => responses.slice(offset, offset + limit),
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
      async (offset, limit) => responses.slice(offset, offset + limit),
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
  });
});
