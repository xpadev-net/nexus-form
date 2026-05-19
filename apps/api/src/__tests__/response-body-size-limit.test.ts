import { zValidator } from "@hono/zod-validator";
import {
  MAX_RESPONSE_DATA_JSON_BYTES,
  MAX_RESPONSE_ITEMS,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Env } from "../lib/hono";
import { createRequestBodySizeLimit } from "../lib/request-body-size-limit";
import { stringifyResponseDataJson } from "../lib/response-data-json";

const responseSubmitSchema = z.object({
  responses: z.array(responsePayloadItemSchema).max(MAX_RESPONSE_ITEMS),
});

describe("response payload limits", () => {
  it("returns 413 before validation when the JSON body is too large", async () => {
    const app = new Hono<Env>().post(
      "/submit",
      createRequestBodySizeLimit({ maxBytes: 32 }),
      zValidator("json", responseSubmitSchema),
      (c) => c.json({ ok: true }),
    );

    const response = await app.request("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responses: [], padding: "x".repeat(64) }),
    });

    expect(response.status).toBe(413);
  });

  it("returns 400 when the response array exceeds the schema limit", async () => {
    const app = new Hono<Env>().post(
      "/submit",
      createRequestBodySizeLimit({ maxBytes: 512 * 1024 }),
      zValidator("json", responseSubmitSchema),
      (c) => c.json({ ok: true }),
    );

    const response = await app.request("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        responses: Array.from({ length: MAX_RESPONSE_ITEMS + 1 }, () => ({
          question_id: "question-1",
          question_type: "short_text",
          value: "answer",
        })),
      }),
    });

    expect(response.status).toBe(400);
  });

  it("rejects response JSON that exceeds the database text column limit", () => {
    const responseDataJson = stringifyResponseDataJson([
      {
        question_id: "question-1",
        question_type: "long_text",
        value: "x".repeat(MAX_RESPONSE_DATA_JSON_BYTES),
      },
    ]);

    expect(responseDataJson).toBeNull();
  });
});
