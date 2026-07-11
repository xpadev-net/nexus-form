import { describe, expect, it } from "vitest";
import {
  INVALID_REQUEST_TARGET,
  sanitizeRequestTarget,
} from "../request-logging";

describe("sanitizeRequestTarget", () => {
  it.each([
    [
      "relative request target",
      "/api/forms/form-123/responses?limit=10",
      "/api/forms/form-123/responses",
    ],
    [
      "absolute HTTPS request target",
      "https://api.example.test/api/forms/form-123/editor?tab=responses",
      "/api/forms/form-123/editor",
    ],
    [
      "absolute HTTP request target with a fragment",
      "http://api.example.test/api/forms/form-123#responses",
      "/api/forms/form-123",
    ],
  ])("preserves the safe path for %s", (_label, input, expected) => {
    expect(sanitizeRequestTarget(input)).toBe(expected);
  });

  it.each([
    [
      "/api/auth/callback/discord?code=code-secret&state=state-secret",
      "/api/auth/callback/discord",
    ],
    [
      "/api/auth/reset-password/reset-token-secret?redirect=secret",
      "/api/auth/reset-password/[REDACTED]",
    ],
    [
      "/api/auth/reset%2Dpassword/reset-token-secret",
      "/api/auth/reset%2Dpassword/[REDACTED]",
    ],
    ["/api/forms/123?shareToken=share-secret", "/api/forms/123"],
    [
      "/api/auth/code/code-secret/state/state-secret",
      "/api/auth/code/[REDACTED]/state/[REDACTED]",
    ],
    ["/api/forms/shareToken/share-secret", "/api/forms/shareToken/[REDACTED]"],
    [
      "/api/forms/invites/invite-secret/accept",
      "/api/forms/invites/[REDACTED]/accept",
    ],
    [
      "/api/forms/invitations/invite-secret",
      "/api/forms/invitations/[REDACTED]",
    ],
    ["/api/forms/shared/shared-link-secret", "/api/forms/shared/[REDACTED]"],
    [
      "/api/forms/shared-link/shared-link-secret",
      "/api/forms/shared-link/[REDACTED]",
    ],
    [
      "/api/forms/sh%61red/shared%2Dlink-secret",
      "/api/forms/sh%61red/[REDACTED]",
    ],
  ])("does not return credential-bearing values for %s", (input, expected) => {
    const sanitized = sanitizeRequestTarget(input);

    expect(sanitized).toBe(expected);
    expect(sanitized).not.toContain("secret");
    expect(sanitized).not.toContain("code-secret");
    expect(sanitized).not.toContain("state-secret");
    expect(sanitized).not.toContain("invite-secret");
    expect(sanitized).not.toContain("shared-link-secret");
  });

  it.each([
    "",
    "not-a-url",
    "//other-host/api/forms",
    "ftp://api.example.test/api/forms",
    "https://[invalid/api/forms",
    "/api/forms/%E0%A4%A",
    "/api/forms/%2e%2e/secret",
    "/api/forms/./secret",
    "/api/auth/callback;code=code-secret;state=state-secret",
    "/api/auth/callback%3Bcode=code-secret%3Bstate=state-secret",
    "/api/auth/callback%253Bcode=code-secret%253Bstate=state-secret",
    "/api/forms/%2573hared/shared-link-secret",
    "https://api.test/api/forms/sh%2561red/shared-link-secret",
    "/api/forms/token%2Fwith-a-slash",
    "/api/forms/%00credential",
    "/api/forms/token%ZZ",
  ])("fails closed for malformed or ambiguous input %s", (input) => {
    expect(sanitizeRequestTarget(input)).toBe(INVALID_REQUEST_TARGET);
  });
});
