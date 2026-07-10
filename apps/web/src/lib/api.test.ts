import { describe, expect, it } from "vitest";
import { type RpcError, rpc } from "./api";

function rejectedRpc(response: Response): Promise<unknown> {
  return rpc(Promise.resolve(response));
}

describe("rpc error responses", () => {
  it("prefers nested error metadata and preserves the response details", async () => {
    const responseBody = {
      error: {
        message: "Nested failure",
        code: "NESTED_CODE",
        details: { field: "email" },
      },
      message: "Flat failure",
    };

    await expect(
      rejectedRpc(new Response(JSON.stringify(responseBody), { status: 422 })),
    ).rejects.toMatchObject({
      name: "RpcError",
      message: "Nested failure",
      status: 422,
      code: "NESTED_CODE",
      details: responseBody,
    } satisfies Partial<RpcError>);
  });

  it("supports flat error and flat message envelopes", async () => {
    const flatResponseBody = {
      error: "Flat failure",
      code: "FLAT_CODE",
      details: { field: "name" },
    };

    await expect(
      rejectedRpc(
        new Response(JSON.stringify(flatResponseBody), { status: 400 }),
      ),
    ).rejects.toMatchObject({
      message: "Flat failure",
      status: 400,
      code: "FLAT_CODE",
      details: flatResponseBody,
    });

    await expect(
      rejectedRpc(
        new Response(JSON.stringify({ message: "Message failure" }), {
          status: 409,
        }),
      ),
    ).rejects.toMatchObject({ message: "Message failure", status: 409 });
  });

  it("falls through empty messages in the documented priority order", async () => {
    await expect(
      rejectedRpc(
        new Response(
          JSON.stringify({ error: { message: "" }, message: "Flat failure" }),
          { status: 400 },
        ),
      ),
    ).rejects.toMatchObject({ message: "Flat failure", status: 400 });

    await expect(
      rejectedRpc(
        new Response(
          JSON.stringify({ error: "", message: "Message failure" }),
          {
            status: 409,
          },
        ),
      ),
    ).rejects.toMatchObject({ message: "Message failure", status: 409 });
  });

  it("falls back to the HTTP status for malformed or unusable bodies", async () => {
    const responses = [
      new Response("not json", { status: 502 }),
      new Response(JSON.stringify({ error: { message: 123 } }), {
        status: 400,
      }),
      new Response(JSON.stringify([]), { status: 422 }),
      new Response(JSON.stringify(null), { status: 500 }),
    ];

    for (const response of responses) {
      await expect(rejectedRpc(response)).rejects.toMatchObject({
        message: `HTTP ${response.status}`,
        status: response.status,
        code: null,
        details: null,
      });
    }
  });

  it("returns the inferred success JSON without changing the response body", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });

    await expect(rpc(Promise.resolve(response))).resolves.toEqual({ ok: true });
  });
});
