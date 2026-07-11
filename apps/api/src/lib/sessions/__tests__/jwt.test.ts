import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@nexus-form/database", () => ({
  db: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  formSession: { id: "formSession.id" },
}));

const FORM_A = "form-a";
const FORM_B = "form-b";
const PASSWORD_HASH_A = "$2b$10$stored-password-hash-a";
const PASSWORD_HASH_B = "$2b$10$stored-password-hash-b";

const passwordGrantA = {
  formId: FORM_A,
  publishedVersion: 7,
  passwordHash: PASSWORD_HASH_A,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("session JWT password grants", () => {
  it("binds an opaque V2 grant to the published version and password hash", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { signSessionJwt, verifySessionJwt } = await import("../jwt");

    const token = signSessionJwt("session-1", {
      passwordGrant: passwordGrantA,
    });

    expect(token).not.toContain(PASSWORD_HASH_A);
    expect(verifySessionJwt(token)).toMatchObject({
      sessionId: "session-1",
      verifiedFormGrants: [
        {
          formId: FORM_A,
          revision: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
      ],
    });
    expect(verifySessionJwt(token, passwordGrantA)).not.toBeNull();
    expect(
      verifySessionJwt(token, {
        ...passwordGrantA,
        publishedVersion: passwordGrantA.publishedVersion + 1,
      }),
    ).toBeNull();
    expect(
      verifySessionJwt(token, {
        ...passwordGrantA,
        passwordHash: PASSWORD_HASH_B,
      }),
    ).toBeNull();
  });

  it("replaces only the verified form grant while preserving other forms", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { getPasswordGrantRevision, signSessionJwt, verifySessionJwt } =
      await import("../jwt");

    const token = signSessionJwt("session-1", {
      verifiedFormGrants: [
        {
          formId: FORM_A,
          revision: "A".repeat(43),
        },
        {
          formId: FORM_B,
          revision: "B".repeat(43),
        },
      ],
      passwordGrant: passwordGrantA,
    });

    expect(verifySessionJwt(token)?.verifiedFormGrants).toEqual([
      {
        formId: FORM_B,
        revision: "B".repeat(43),
      },
      {
        formId: FORM_A,
        revision: getPasswordGrantRevision(passwordGrantA),
      },
    ]);
  });

  it("validates the V2 claim at runtime and fails protected checks for legacy claims", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { verifySessionJwt } = await import("../jwt");

    const malformedV2Token = jwt.sign(
      {
        sessionId: "session-1",
        verifiedFormGrants: [{ formId: FORM_A, revision: "not-opaque" }],
      },
      "auth-secret-a",
      { algorithm: "HS256" },
    );
    expect(verifySessionJwt(malformedV2Token)).toBeNull();

    const legacyToken = jwt.sign(
      { sessionId: "session-1", verifiedForms: [FORM_A] },
      "auth-secret-a",
      { algorithm: "HS256" },
    );
    expect(verifySessionJwt(legacyToken)).toMatchObject({
      sessionId: "session-1",
      verifiedForms: [FORM_A],
    });
    expect(verifySessionJwt(legacyToken, passwordGrantA)).toBeNull();
  });

  it("invalidates JWTs and grant revisions when AUTH_SECRET rotates", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { getPasswordGrantRevision, signSessionJwt, verifySessionJwt } =
      await import("../jwt");
    const token = signSessionJwt("session-1", {
      passwordGrant: passwordGrantA,
    });
    const revisionA = getPasswordGrantRevision(passwordGrantA);

    vi.stubEnv("AUTH_SECRET", "auth-secret-b");

    expect(verifySessionJwt(token)).toBeNull();
    expect(getPasswordGrantRevision(passwordGrantA)).not.toBe(revisionA);
  });
});
