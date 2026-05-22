import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_REDIRECT,
  getAuthRedirect,
  sanitizeAuthRedirect,
} from "./auth-redirect";

describe("auth redirect sanitization", () => {
  it("keeps same-origin relative paths with search and hash", () => {
    expect(sanitizeAuthRedirect("/forms/form-1/edit?tab=responses#top")).toBe(
      "/forms/form-1/edit?tab=responses#top",
    );
  });

  it("rejects external and scheme-like redirect targets", () => {
    expect(sanitizeAuthRedirect("https://example.com/forms/form-1")).toBe(
      undefined,
    );
    expect(sanitizeAuthRedirect("//example.com/forms/form-1")).toBe(undefined);
    expect(sanitizeAuthRedirect("javascript:alert(1)")).toBe(undefined);
  });

  it("falls back to the app root for unsafe or login-loop redirects", () => {
    expect(getAuthRedirect("/login?redirect=/forms/form-1/edit")).toBe(
      DEFAULT_AUTH_REDIRECT,
    );
    expect(getAuthRedirect("/login#discord")).toBe(DEFAULT_AUTH_REDIRECT);
    expect(getAuthRedirect("/login/?redirect=/forms/form-1/edit")).toBe(
      DEFAULT_AUTH_REDIRECT,
    );
    expect(getAuthRedirect("https://example.com")).toBe(DEFAULT_AUTH_REDIRECT);
  });
});
