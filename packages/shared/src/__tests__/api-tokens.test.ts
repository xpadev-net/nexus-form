import { describe, expect, it } from "vitest";
import {
  API_TOKEN_FORM_IDS_MAX,
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

  it("rejects form ID arrays above the maximum length", () => {
    const tooManyFormIds = Array.from(
      { length: API_TOKEN_FORM_IDS_MAX + 1 },
      (_, index) => `form-${index}`,
    );
    expect(apiTokenFormIdsSchema.safeParse(tooManyFormIds).success).toBe(false);
    expect(() => parseStoredApiTokenFormIds(tooManyFormIds)).toThrow();
  });

  it("accepts form ID arrays up to the maximum length", () => {
    const maxFormIds = Array.from(
      { length: API_TOKEN_FORM_IDS_MAX },
      (_, index) => `form-${index}`,
    );
    expect(apiTokenFormIdsSchema.parse(maxFormIds)).toEqual(maxFormIds);
  });

  it("normalizes nullish stored form IDs to undefined", () => {
    expect(parseStoredApiTokenFormIds(null)).toBeUndefined();
    expect(parseStoredApiTokenFormIds(undefined)).toBeUndefined();
  });
});
