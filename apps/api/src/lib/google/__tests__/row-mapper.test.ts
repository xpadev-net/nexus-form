import { describe, expect, it } from "vitest";
import type { Response } from "../../../types/domain/response";
import { mapResponseToRow } from "../row-mapper";

function makeResponse(partial: Partial<Response>): Response {
  return {
    metadata: {
      id: "resp_1",
      form_id: "form_1",
      respondent_uuid: "u1",
      submitted_at: new Date().toISOString(),
    },
    responses: [],
    ...partial,
  } as Response;
}

describe("mapResponseToRow", () => {
  it("??????1???Response ID", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Name",
          value: "Alice",
        },
      ],
    });

    const { headers, row } = mapResponseToRow([], res);
    expect(headers[0]).toBe("Response ID");
    expect(row[0]).toBe("resp_1");
  });

  it("???????????????????extend", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Name",
          value: "Alice",
        },
        {
          question_id: "q2",
          question_type: "short_text",
          question_title: "Email",
          value: "a@example.com",
        },
      ],
    });

    const existing = ["Response ID", "Name"]; // Email ???
    const { headers, row } = mapResponseToRow(existing, res);

    expect(headers).toEqual(["Response ID", "Name", "Email"]);
    expect(row).toEqual(["resp_1", "Alice", "a@example.com"]);
  });

  it("?????????????????????", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Name",
          value: "Alice",
        },
        {
          question_id: "q2",
          question_type: "short_text",
          question_title: "Email",
          value: "a@example.com",
        },
      ],
    });

    const existing = ["Response ID", "Email", "Name"]; // ???
    const { row } = mapResponseToRow(existing, res);

    expect(row).toEqual(["resp_1", "a@example.com", "Alice"]);
  });

  it("??????? (2) ??????????extend", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Choice",
          value: "A",
        },
        {
          question_id: "q2",
          question_type: "short_text",
          question_title: "Choice",
          value: "B",
        },
        {
          question_id: "q3",
          question_type: "short_text",
          question_title: "Choice",
          value: "C",
        },
      ],
    });

    const existing = ["Response ID", "Choice"]; // 2???Choice?1?
    const { headers, row } = mapResponseToRow(existing, res);

    expect(headers).toEqual([
      "Response ID",
      "Choice",
      "Choice (2)",
      "Choice (3)",
    ]);
    expect(row).toEqual(["resp_1", "A", "B", "C"]);
  });

  it("?????????", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Name",
          value: "",
        },
        {
          question_id: "q2",
          question_type: "checkbox",
          question_title: "Tags",
          values: [],
        },
      ],
    });

    const { headers, row } = mapResponseToRow([], res);
    expect(headers).toEqual(["Response ID", "Name", "Tags"]);
    expect(row).toEqual(["resp_1", "", ""]);
  });

  it("?????????????????????", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Choice",
          value: "A",
        },
        {
          question_id: "q2",
          question_type: "short_text",
          question_title: "Choice",
          value: "B",
        },
      ],
    });

    const existing = ["Response ID", "Choice", "Choice (2)", "Choice (3)"];
    const { headers, row } = mapResponseToRow(existing, res);

    expect(headers).toEqual([
      "Response ID",
      "Choice",
      "Choice (2)",
      "Choice (3)",
    ]);
    expect(row).toEqual(["resp_1", "A", "B", ""]);
  });

  it("?????????????????????", () => {
    const res = makeResponse({
      responses: [
        {
          question_id: "q1",
          question_type: "short_text",
          question_title: "Choice",
          value: "A",
        },
        {
          question_id: "q2",
          question_type: "short_text",
          question_title: "Choice",
          value: "B",
        },
        {
          question_id: "q3",
          question_type: "short_text",
          question_title: "Choice",
          value: "C",
        },
        {
          question_id: "q4",
          question_type: "short_text",
          question_title: "Choice",
          value: "D",
        },
      ],
    });

    const existing = ["Response ID", "Choice", "Choice (2)"];
    const { headers, row } = mapResponseToRow(existing, res);

    expect(headers).toEqual([
      "Response ID",
      "Choice",
      "Choice (2)",
      "Choice (3)",
      "Choice (4)",
    ]);
    expect(row).toEqual(["resp_1", "A", "B", "C", "D"]);
  });
});
