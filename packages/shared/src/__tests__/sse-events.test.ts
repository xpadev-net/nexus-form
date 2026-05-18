import { describe, expect, it } from "vitest";
import { getEditorChannel, getValidationChannel } from "../sse-events";

describe("Redis SSE channel helpers", () => {
  it("builds validation and editor channels for safe form IDs", () => {
    expect(getValidationChannel("form_123-ABC")).toBe(
      "form:validation:form_123-ABC",
    );
    expect(getEditorChannel("form_123-ABC")).toBe("form:editor:form_123-ABC");
  });

  it("rejects wildcard form IDs before building Redis channel names", () => {
    expect(() => getValidationChannel("form*")).toThrow();
    expect(() => getEditorChannel("form*")).toThrow();
  });

  it("rejects newline-delimited form IDs before building Redis channel names", () => {
    expect(() => getValidationChannel("form\nother")).toThrow();
    expect(() => getEditorChannel("form\nother")).toThrow();
  });

  it("rejects empty and overlong form IDs", () => {
    expect(() => getValidationChannel("")).toThrow();
    expect(() => getEditorChannel("a".repeat(65))).toThrow();
  });
});
