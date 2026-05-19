import { createMiddleware } from "hono/factory";
import { errorResponse } from "../types/domain/common";
import type { Env } from "./hono";

type RequestBodySizeLimitOptions = {
  maxBytes: number;
};

export function createRequestBodySizeLimit({
  maxBytes,
}: RequestBodySizeLimitOptions) {
  return createMiddleware<Env>(async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const parsedContentLength = Number(contentLength);
      if (
        Number.isFinite(parsedContentLength) &&
        parsedContentLength > maxBytes
      ) {
        return c.json(errorResponse("Request body too large"), 413);
      }
    }

    const originalBody = c.req.raw.body;
    if (originalBody) {
      const reader = originalBody.getReader();
      const chunks: ArrayBuffer[] = [];
      let bytesRead = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          bytesRead += value.byteLength;
          if (bytesRead > maxBytes) {
            await reader.cancel();
            return c.json(errorResponse("Request body too large"), 413);
          }

          const chunk = new Uint8Array(value.byteLength);
          chunk.set(value);
          chunks.push(chunk.buffer);
        }
      } finally {
        reader.releaseLock();
      }

      c.req.raw = new Request(c.req.raw, {
        body: new Blob(chunks),
      });
    }

    await next();
  });
}
