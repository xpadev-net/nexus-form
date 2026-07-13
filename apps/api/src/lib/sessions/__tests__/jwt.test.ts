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
const GENERATION_A = 9_007_199_254_740_992n;
const GENERATION_B = 9_007_199_254_740_993n;

const passwordGrantA = {
  formId: FORM_A,
  publicPasswordGrantGeneration: GENERATION_A,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("session JWT password grants", () => {
  it("binds an opaque V2 grant to the bigint generation without Number coercion or password material", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { signSessionJwt, verifySessionJwt } = await import("../jwt");

    const token = signSessionJwt("session-1", {
      passwordGrant: passwordGrantA,
    });

    const decoded = jwt.decode(token);
    expect(decoded).toMatchObject({
      sessionId: "session-1",
      verifiedFormGrants: [
        {
          formId: FORM_A,
          revision: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
      ],
    });
    const serializedPayload = JSON.stringify(decoded);
    expect(serializedPayload.toLowerCase()).not.toContain("password");
    expect(serializedPayload.toLowerCase()).not.toContain("hash");
    expect(serializedPayload).not.toContain(GENERATION_A.toString(10));
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
        publicPasswordGrantGeneration: GENERATION_B,
      }),
    ).toBeNull();
  });

  it("never revives an old grant across password, publication, and historical activation lifecycles", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { signSessionJwt, verifySessionJwt } = await import("../jwt");
    const originalGrant = {
      formId: FORM_A,
      publicPasswordGrantGeneration: 40n,
    };
    const token = signSessionJwt("session-1", {
      passwordGrant: originalGrant,
    });

    const lifecycleGenerations = [
      41n, // password A -> B
      42n, // disable -> same-A re-enable
      43n, // direct v3 -> v8
      44n, // direct v8 -> historical v3
      45n, // scheduled historical activation
    ];
    for (const publicPasswordGrantGeneration of lifecycleGenerations) {
      expect(
        verifySessionJwt(token, {
          formId: FORM_A,
          publicPasswordGrantGeneration,
        }),
      ).toBeNull();
    }
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

  it("rejects invalid persistent generation contexts at runtime", async () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret-a");
    const { getPasswordGrantRevision } = await import("../jwt");

    expect(() =>
      getPasswordGrantRevision({
        formId: FORM_A,
        publicPasswordGrantGeneration: -1n,
      }),
    ).toThrow();
    expect(() =>
      getPasswordGrantRevision({
        formId: FORM_A,
        publicPasswordGrantGeneration: 18_446_744_073_709_551_616n,
      }),
    ).toThrow();
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
