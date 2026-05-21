import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, op: "and" })),
  anonymized: vi.fn(),
  authContext: { auth_type: "session" as const, user_id: "user-1" },
  checkFormAccess: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, op: "eq", right })),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({
    left,
    op: "inArray",
    values,
  })),
  lt: vi.fn((left: unknown, right: unknown) => ({ left, op: "lt", right })),
  responseLimit: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mocks.responseLimit,
        })),
      })),
    })),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  fingerprintDetail: {
    collectedAt: "fingerprintDetail.collectedAt",
    componentName: "fingerprintDetail.componentName",
    componentValueHash: "fingerprintDetail.componentValueHash",
    expiresAt: "fingerprintDetail.expiresAt",
    fingerprintType: "fingerprintDetail.fingerprintType",
    id: "fingerprintDetail.id",
    responseId: "fingerprintDetail.responseId",
  },
  formResponse: {
    formId: "formResponse.formId",
    id: "formResponse.id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  inArray: mocks.inArray,
  lt: mocks.lt,
}));

vi.mock("../lib/dual-auth", () => ({
  checkFormAccess: mocks.checkFormAccess,
  hasEditPermission: vi.fn(),
  withDualAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", mocks.authContext);
      await next();
    };
  },
}));

vi.mock("../lib/fingerprint/anonymizer", () => ({
  getFingerprintAnonymizer: () => ({
    getAnonymizedFingerprints: mocks.anonymized,
  }),
}));

vi.mock("../lib/fingerprint/data-retention", () => ({
  getDataRetentionManager: vi.fn(),
}));

describe("GET /anonymized fingerprint authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkFormAccess.mockResolvedValue(true);
    mocks.responseLimit.mockResolvedValue([{ formId: "form-a" }]);
    mocks.anonymized.mockResolvedValue({ fingerprints: [] });
  });

  it("rejects mismatched formId and responseId before anonymizing", async () => {
    mocks.responseLimit.mockResolvedValue([{ formId: "other-form" }]);
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?formId=form-a&responseId=response-b",
    );

    expect(response.status).toBe(404);
    expect(mocks.checkFormAccess).toHaveBeenCalledWith(
      mocks.authContext,
      "form-a",
    );
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.anonymized).not.toHaveBeenCalled();
  });

  it("allows matching formId and responseId to be anonymized", async () => {
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?formId=form-a&responseId=response-a&includeStats=true",
    );

    expect(response.status).toBe(200);
    expect(mocks.anonymized).toHaveBeenCalledWith("response-a", "form-a", true);
  });
});

describe("GET /get fingerprint authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkFormAccess.mockResolvedValue(true);
    mocks.responseLimit.mockResolvedValue([{ formId: "form-a" }]);
    mocks.anonymized.mockResolvedValue({ fingerprints: [] });
  });

  it("rejects mismatched formId and responseId before reading fingerprint rows", async () => {
    mocks.responseLimit.mockResolvedValue([{ formId: "other-form" }]);
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/get?formId=form-a&responseId=response-b",
    );

    expect(response.status).toBe(404);
    expect(mocks.checkFormAccess).toHaveBeenCalledWith(
      mocks.authContext,
      "form-a",
    );
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.eq).toHaveBeenCalledWith("formResponse.id", "response-b");
    expect(mocks.eq).not.toHaveBeenCalledWith(
      "fingerprintDetail.responseId",
      "response-b",
    );
  });
});
