import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getActivePublication: vi.fn(),
  getLatestSnapshot: vi.fn(),
  verifyPassword: vi.fn(),
  extractJwtFromRequest: vi.fn(),
  verifySessionJwt: vi.fn(),
  signSessionJwt: vi.fn(),
  processFormSchedule: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  assertRequiredSecurityMigrationsApplied: vi.fn().mockResolvedValue(undefined),
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => {
  const column = new Proxy(
    {},
    {
      get: (_target, property) => property,
    },
  );
  return {
    externalServiceValidationResult: column,
    form: column,
    formIntegration: column,
    formResponse: column,
    formSchedule: column,
  };
});

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: vi.fn().mockReturnValue(undefined),
    getAll: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  count: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
}));

vi.mock("../lib/forms/parse-stored-structure", () => ({
  parseStoredStructure: (structureJson: string) => JSON.parse(structureJson),
}));

vi.mock("../lib/forms/permission-service", () => ({
  validateShareLink: vi.fn(),
}));

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContentStrict: vi.fn(),
  buildReachableQuestionIdsFromPlateContentStrict: vi.fn(),
  PlateQuestionBuildError: class PlateQuestionBuildError extends Error {},
}));

vi.mock("../lib/forms/public-structure", () => ({
  buildPublicFormStructure: vi.fn(),
}));

vi.mock("../lib/forms/response-validator", () => ({
  buildResponseAnswerRecord: vi.fn(),
  validateReachableResponseData: vi.fn(),
  validateResponseData: vi.fn(),
}));

vi.mock("../lib/forms/schedule-error-logging", () => ({
  logFormScheduleError: vi.fn(),
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: mocks.processFormSchedule,
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getActivePublication: mocks.getActivePublication,
  getLatestSnapshot: mocks.getLatestSnapshot,
}));

vi.mock("../lib/forms/submit-outbox-sweeper", () => ({
  insertSubmitOutboxRows: vi.fn(),
  recoverSubmitOutboxForResponse: vi.fn(),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(),
}));

vi.mock("../lib/ip-address", () => ({
  extractClientIP: vi
    .fn()
    .mockReturnValue({ ip: "127.0.0.1", source: "socket" }),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/queues", () => ({
  getValidationQueue: vi.fn(),
  isValidServiceName: vi.fn(),
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("../lib/security/form-security-bypass", () => ({
  isFormSecurityBypassEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/security/hcaptcha", () => ({
  verifyHCaptcha: vi.fn(),
}));

vi.mock("../lib/security/password", () => ({
  verifyPassword: mocks.verifyPassword,
}));

vi.mock("../lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../lib/sessions/jwt", () => ({
  extractJwtFromRequest: mocks.extractJwtFromRequest,
  resolveSessionIdOrCreate: vi.fn().mockResolvedValue({
    sessionId: "session-1",
    jwt: "jwt-1",
  }),
  signSessionJwt: mocks.signSessionJwt,
  verifySessionJwt: mocks.verifySessionJwt,
}));

vi.mock("../lib/telemetry/tokens", () => ({
  consumeTokensOrThrow: vi.fn(),
  hashIPAddress: (ip: string) => `hash:${ip}`,
}));

const FORM_LOOKUP = {
  id: "form-1",
  status: "PUBLISHED",
  dueScheduleId: null,
};

function setPublishedForm(): void {
  mocks.db.select.mockReturnValue({
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          limit: async () => [FORM_LOOKUP],
        }),
      }),
    }),
  });
}

function setPasswordSnapshot(): void {
  const snapshot = {
    structureJson: JSON.stringify({
      access_control: {
        password_protection: {
          enabled: true,
          password: "stored-password-hash",
        },
      },
    }),
  };
  mocks.getLatestSnapshot.mockResolvedValue(snapshot);
  mocks.getActivePublication.mockResolvedValue({
    snapshot,
    publicPasswordGrantGeneration: 1n,
  });
}

describe("public password request limits", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.extractJwtFromRequest.mockReturnValue(null);
    mocks.verifySessionJwt.mockReturnValue(null);
  });

  it("rejects an oversized declared Content-Length before JSON validation or hashing", async () => {
    const { formsPublicRouter, MAX_PUBLIC_PASSWORD_REQUEST_BODY_BYTES } =
      await import("../routes/forms-public");
    let cancelCalled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ password: "valid-password" }),
          ),
        );
      },
      cancel() {
        cancelCalled = true;
      },
    });
    const requestInit: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        "content-length": String(MAX_PUBLIC_PASSWORD_REQUEST_BODY_BYTES + 1),
        "content-type": "application/json",
      },
      body,
      duplex: "half",
    };
    const response = await formsPublicRouter.fetch(
      new Request(
        "http://localhost/public/public-id/verify-password",
        requestInit,
      ),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large",
    });
    expect(cancelCalled).toBe(true);
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body before JSON materialization or hashing", async () => {
    const { formsPublicRouter, MAX_PUBLIC_PASSWORD_REQUEST_BODY_BYTES } =
      await import("../routes/forms-public");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            "x".repeat(MAX_PUBLIC_PASSWORD_REQUEST_BODY_BYTES + 1),
          ),
        );
        controller.close();
      },
    });

    const requestInit: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    };
    const response = await formsPublicRouter.fetch(
      new Request(
        "http://localhost/public/public-id/verify-password",
        requestInit,
      ),
    );

    expect(response.status).toBe(413);
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON without looking up the form or hashing", async () => {
    const { formsPublicRouter } = await import("../routes/forms-public");

    const response = await formsPublicRouter.request(
      "/public/public-id/verify-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("accepts the exact password maximum and calls verification", async () => {
    setPublishedForm();
    setPasswordSnapshot();
    mocks.verifyPassword.mockResolvedValueOnce(true);
    const { formsPublicRouter, MAX_PUBLIC_PASSWORD_LENGTH } = await import(
      "../routes/forms-public"
    );
    const password = "x".repeat(MAX_PUBLIC_PASSWORD_LENGTH);

    const response = await formsPublicRouter.request(
      "/public/public-id/verify-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
    expect(mocks.verifyPassword).toHaveBeenCalledWith(
      password,
      "stored-password-hash",
    );
  });

  it("rejects a password one character over the maximum before hashing", async () => {
    const { formsPublicRouter, MAX_PUBLIC_PASSWORD_LENGTH } = await import(
      "../routes/forms-public"
    );
    const password = "x".repeat(MAX_PUBLIC_PASSWORD_LENGTH + 1);

    const response = await formsPublicRouter.request(
      "/public/public-id/verify-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it.each([
    { password: "wrong-password", valid: false },
    { password: "correct-password", valid: true },
  ])("preserves ordinary $password verification", async ({
    password,
    valid,
  }) => {
    setPublishedForm();
    setPasswordSnapshot();
    mocks.verifyPassword.mockResolvedValueOnce(valid);
    const { formsPublicRouter } = await import("../routes/forms-public");

    const response = await formsPublicRouter.request(
      "/public/public-id/verify-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid });
    expect(mocks.verifyPassword).toHaveBeenCalledWith(
      password,
      "stored-password-hash",
    );
  });
});
