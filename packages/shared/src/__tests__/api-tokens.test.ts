import { describe, expect, it } from "vitest";
import {
  apiTokenFormIdsSchema,
  parseApiTokenScopes,
  parseStoredApiTokenFormIds,
} from "../api-tokens";

describe("API token JSON schemas", () => {
  it("accepts valid API token scopes", () => {
    expect(parseApiTokenScopes(["read"])).toEqual(["read"]);
    expect(parseApiTokenScopes(["read", "write", "admin"])).toEqual([
      "read",
      "write",
      "admin",
    ]);
  });

  it("rejects invalid API token scopes", () => {
    expect(() => parseApiTokenScopes([])).toThrow();
    expect(() => parseApiTokenScopes(["owner"])).toThrow();
  });

  it("rejects empty form ID arrays", () => {
    expect(apiTokenFormIdsSchema.safeParse([]).success).toBe(false);
    expect(() => parseStoredApiTokenFormIds([])).toThrow();
  });

  it("normalizes nullish stored form IDs to undefined", () => {
    expect(parseStoredApiTokenFormIds(null)).toBeUndefined();
    expect(parseStoredApiTokenFormIds(undefined)).toBeUndefined();
  });
});
