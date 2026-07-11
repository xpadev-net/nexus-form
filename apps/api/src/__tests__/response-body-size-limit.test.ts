import { zValidator } from "@hono/zod-validator";
import {
  MAX_RESPONSE_DATA_JSON_BYTES,
  MAX_RESPONSE_ITEMS,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
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

  it("allows a body at the exact byte limit", async () => {
    const handler = vi.fn((c: Context<Env>) => c.json({ ok: true }));
    const app = new Hono<Env>().post(
      "/submit",
      createRequestBodySizeLimit({ maxBytes: 32 }),
      handler,
    );

    const response = await app.request("/submit", {
      method: "POST",
      body: "x".repeat(32),
    });

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects a streamed body over the limit before the handler", async () => {
    const handler = vi.fn((c: Context<Env>) => c.json({ ok: true }));
    const app = new Hono<Env>().post(
      "/submit",
      createRequestBodySizeLimit({ maxBytes: 32 }),
      handler,
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(33)));
        controller.close();
      },
    });

    const requestInit: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
    };
    const response = await app.fetch(
      new Request("http://localhost/submit", requestInit),
    );

    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the 413 response when declared-body cancellation rejects", async () => {
    const app = new Hono<Env>().post(
      "/submit",
      createRequestBodySizeLimit({ maxBytes: 32 }),
      () => new Response("unexpected"),
    );
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("cancel failed");
      },
    });
    const requestInit: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-length": "33" },
      body,
      duplex: "half",
    };

    const response = await app.fetch(
      new Request("http://localhost/submit", requestInit),
    );

    expect(response.status).toBe(413);
  });

  it("returns 400 for invalid JSON under the byte limit", async () => {
    const handler = vi.fn((c: Context<Env>) => c.json({ ok: true }));
    const app = new Hono<Env>().post(
      "/submit",
      createRequestBodySizeLimit({ maxBytes: 32 }),
      zValidator("json", z.object({ password: z.string() })),
      handler,
    );

    const response = await app.request("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
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
