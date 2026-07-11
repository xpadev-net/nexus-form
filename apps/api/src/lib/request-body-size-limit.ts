import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono/types";
import { errorResponse } from "../types/domain/common";
import type { Env } from "./hono";

type RequestBodySizeLimitOptions = {
  maxBytes: number;
};

function toBlobPart(chunk: Uint8Array): BlobPart {
  if (chunk.buffer instanceof ArrayBuffer) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  return chunk.slice();
}

async function cancelRequestBody(request: Request): Promise<void> {
  const body = request.body;
  if (!body || request.bodyUsed || body.locked) return;

  try {
    await body.cancel();
  } catch {
    // The request is rejected regardless; cancellation is best effort because
    // a disturbed stream or an upstream reader may already own the body.
  }
}

/**
 * Creates middleware that rejects request bodies larger than maxBytes.
 *
 * @param options.maxBytes - Maximum request body size in bytes.
 * @returns Hono middleware that returns 413 when the body exceeds the limit.
 */
export function createRequestBodySizeLimit({
  maxBytes,
}: RequestBodySizeLimitOptions): MiddlewareHandler<Env> {
  return createMiddleware<Env>(async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const parsedContentLength = Number(contentLength);
      if (
        Number.isFinite(parsedContentLength) &&
        parsedContentLength > maxBytes
      ) {
        await cancelRequestBody(c.req.raw);
        return c.json(errorResponse("Request body too large"), 413);
      }
    }

    const originalBody = c.req.raw.body;
    if (originalBody) {
      const reader = originalBody.getReader();
      const chunks: BlobPart[] = [];
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

          chunks.push(toBlobPart(value));
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
