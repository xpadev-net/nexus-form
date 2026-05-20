import { describe, expect, it } from "vitest";
import { ErrorResponseSchema, errorResponse } from "./common";

describe("common error response contract", () => {
  it("returns only the canonical error string payload", () => {
    expect(errorResponse("Unauthorized")).toEqual({ error: "Unauthorized" });
    expect(ErrorResponseSchema.parse(errorResponse("Unauthorized"))).toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects legacy expanded error payloads", () => {
    expect(() =>
      ErrorResponseSchema.parse({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        statusCode: 401,
      }),
    ).toThrow();
  });
});
