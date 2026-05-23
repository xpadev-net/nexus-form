import { describe, expect, it } from "vitest";
import {
  getEditorChannel,
  getValidationChannel,
  parseSseAccessRevokedEvent,
} from "../sse-events";

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

describe("parseSseAccessRevokedEvent", () => {
  it("parses a valid access-revoke payload", () => {
    const payload = {
      type: "sse_access_revoked" as const,
      formId: "form-1",
      userId: "user-1",
      timestamp: "2026-05-23T00:00:00.000Z",
    };

    expect(parseSseAccessRevokedEvent(JSON.stringify(payload))).toEqual(
      payload,
    );
  });

  it("returns null for unrelated SSE payloads", () => {
    expect(
      parseSseAccessRevokedEvent(
        JSON.stringify({ type: "validation_status_changed" }),
      ),
    ).toBeNull();
  });
});
