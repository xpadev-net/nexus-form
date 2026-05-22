import { describe, expect, it } from "vitest";
import { resolveAuditUserId } from "../resolve-audit-user-id";

describe("R12-P3 resolveAuditUserId", () => {
  it("returns null for share-link synthetic principals", () => {
    expect(resolveAuditUserId("share-link:link-1")).toBeNull();
  });

  it("returns null for anon synthetic principals", () => {
    expect(resolveAuditUserId("anon:token-1")).toBeNull();
  });

  it("returns real user ids unchanged", () => {
    expect(resolveAuditUserId("user-123")).toBe("user-123");
  });
});
