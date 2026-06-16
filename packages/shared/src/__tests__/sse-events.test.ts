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
      targetType: "user" as const,
      userId: "user-1",
      timestamp: "2026-05-23T00:00:00.000Z",
    };

    expect(parseSseAccessRevokedEvent(JSON.stringify(payload))).toEqual(
      payload,
    );
  });

  it("parses share-link and form-wide access-revoke payloads", () => {
    const shareLinkPayload = {
      type: "sse_access_revoked" as const,
      formId: "form-1",
      targetType: "share_link" as const,
      shareLinkId: "link-1",
      userId: "share-link:link-1",
      timestamp: "2026-05-23T00:00:00.000Z",
    };
    const formPayload = {
      type: "sse_access_revoked" as const,
      formId: "form-1",
      targetType: "form" as const,
      timestamp: "2026-05-23T00:00:00.000Z",
    };

    expect(
      parseSseAccessRevokedEvent(JSON.stringify(shareLinkPayload)),
    ).toEqual({
      type: "sse_access_revoked",
      formId: "form-1",
      targetType: "share_link",
      shareLinkId: "link-1",
      timestamp: "2026-05-23T00:00:00.000Z",
    });
    expect(parseSseAccessRevokedEvent(JSON.stringify(formPayload))).toEqual(
      formPayload,
    );
  });

  it("normalizes legacy userId-only access-revoke payloads", () => {
    expect(
      parseSseAccessRevokedEvent(
        JSON.stringify({
          type: "sse_access_revoked",
          formId: "form-1",
          userId: "user-1",
          timestamp: "2026-05-23T00:00:00.000Z",
        }),
      ),
    ).toEqual({
      type: "sse_access_revoked",
      formId: "form-1",
      targetType: "user",
      userId: "user-1",
      timestamp: "2026-05-23T00:00:00.000Z",
    });
  });

  it("returns null for unrelated SSE payloads", () => {
    expect(
      parseSseAccessRevokedEvent(
        JSON.stringify({ type: "validation_status_changed" }),
      ),
    ).toBeNull();
  });
});
