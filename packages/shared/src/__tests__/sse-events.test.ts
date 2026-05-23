import { describe, expect, it } from "vitest";
import { parseSseAccessRevokedEvent } from "../sse-events";

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
