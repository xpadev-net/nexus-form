import { describe, expect, it } from "vitest";
import {
  apiTokenFormIdsSchema,
  parseStoredApiTokenFormIds,
} from "../api-tokens";

describe("API token JSON schemas", () => {
  it("rejects empty form ID arrays", () => {
    expect(apiTokenFormIdsSchema.safeParse([]).success).toBe(false);
    expect(() => parseStoredApiTokenFormIds([])).toThrow();
  });

  it("normalizes nullish stored form IDs to undefined", () => {
    expect(parseStoredApiTokenFormIds(null)).toBeUndefined();
    expect(parseStoredApiTokenFormIds(undefined)).toBeUndefined();
  });
});
