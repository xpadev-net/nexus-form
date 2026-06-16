import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

type MockAuthContext =
  | {
      auth_type: "session";
      user_id: string;
    }
  | {
      auth_type: "api_token";
      scopes: string[];
      share_link_id: string;
      token_id: string;
      user_id: string;
    };

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, op: "and" })),
  anonymized: vi.fn(),
  authContext: vi.fn<() => MockAuthContext>(() => ({
    auth_type: "session" as const,
    user_id: "user-1",
  })),
  checkFormPermissionLevel: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, op: "eq", right })),
  fingerprintRows: vi.fn(),
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
        innerJoin: vi.fn(() => ({
          where: mocks.fingerprintRows,
        })),
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
  checkFormPermissionLevel: mocks.checkFormPermissionLevel,
  hasEditPermission: vi.fn(),
  withDualAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", mocks.authContext());
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
    mocks.authContext.mockReturnValue({
      auth_type: "session" as const,
      user_id: "user-1",
    });
    mocks.checkFormPermissionLevel.mockResolvedValue(undefined);
    mocks.responseLimit.mockResolvedValue([{ formId: "form-a" }]);
    mocks.fingerprintRows.mockResolvedValue([]);
    mocks.anonymized.mockResolvedValue({ fingerprints: [] });
  });

  it("rejects mismatched formId and responseId before anonymizing", async () => {
    mocks.responseLimit.mockResolvedValue([{ formId: "other-form" }]);
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?formId=form-a&responseId=response-b",
    );

    expect(response.status).toBe(404);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "session",
        user_id: "user-1",
      }),
      "form-a",
      "EDITOR",
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
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "session",
        user_id: "user-1",
      }),
      "form-a",
      "EDITOR",
    );
    expect(mocks.anonymized).toHaveBeenCalledWith("response-a", "form-a", true);
  });

  it("rejects a session VIEWER with 403", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "session" as const,
      user_id: "viewer-user",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "EDITOR", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?formId=form-a",
    );

    expect(response.status).toBe(403);
    expect(mocks.anonymized).not.toHaveBeenCalled();
  });

  it("rejects a session VIEWER with 403 when only responseId is provided", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "session" as const,
      user_id: "viewer-user",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "EDITOR", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?responseId=response-a",
    );

    expect(response.status).toBe(403);
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "session",
        user_id: "viewer-user",
      }),
      "form-a",
      "EDITOR",
    );
    expect(mocks.anonymized).not.toHaveBeenCalled();
  });

  it("rejects a share-link VIEWER API token with 403", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "api_token" as const,
      scopes: ["read"],
      share_link_id: "link-viewer",
      token_id: "tok-viewer",
      user_id: "share-link:link-viewer",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "EDITOR", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?formId=form-a",
      {
        headers: { authorization: "Bearer share-link-viewer-token" },
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "api_token",
        share_link_id: "link-viewer",
      }),
      "form-a",
      "EDITOR",
    );
    expect(mocks.anonymized).not.toHaveBeenCalled();
  });

  it("rejects a share-link VIEWER API token with 403 when only responseId is provided", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "api_token" as const,
      scopes: ["read"],
      share_link_id: "link-viewer",
      token_id: "tok-viewer",
      user_id: "share-link:link-viewer",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "EDITOR", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/anonymized?responseId=response-a",
      {
        headers: { authorization: "Bearer share-link-viewer-token" },
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "api_token",
        share_link_id: "link-viewer",
      }),
      "form-a",
      "EDITOR",
    );
    expect(mocks.anonymized).not.toHaveBeenCalled();
  });
});

describe("GET /get fingerprint authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authContext.mockReturnValue({
      auth_type: "session" as const,
      user_id: "user-1",
    });
    mocks.checkFormPermissionLevel.mockResolvedValue(undefined);
    mocks.responseLimit.mockResolvedValue([{ formId: "form-a" }]);
    mocks.fingerprintRows.mockResolvedValue([]);
    mocks.anonymized.mockResolvedValue({ fingerprints: [] });
  });

  it("rejects mismatched formId and responseId before reading fingerprint rows", async () => {
    mocks.responseLimit.mockResolvedValue([{ formId: "other-form" }]);
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/get?formId=form-a&responseId=response-b",
    );

    expect(response.status).toBe(404);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "session",
        user_id: "user-1",
      }),
      "form-a",
      "OWNER",
    );
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.eq).toHaveBeenCalledWith("formResponse.id", "response-b");
    expect(mocks.eq).not.toHaveBeenCalledWith(
      "fingerprintDetail.responseId",
      "response-b",
    );
    expect(mocks.fingerprintRows).not.toHaveBeenCalled();
  });

  it("allows matching formId and responseId to read fingerprint rows", async () => {
    mocks.responseLimit.mockResolvedValue([{ formId: "form-a" }]);
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/get?formId=form-a&responseId=response-a",
    );

    expect(response.status).toBe(200);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "session",
        user_id: "user-1",
      }),
      "form-a",
      "OWNER",
    );
    expect(mocks.eq).toHaveBeenCalledWith("formResponse.id", "response-a");
    expect(mocks.eq).toHaveBeenCalledWith(
      "fingerprintDetail.responseId",
      "response-a",
    );
    expect(mocks.fingerprintRows).toHaveBeenCalledWith(
      expect.objectContaining({
        left: "fingerprintDetail.responseId",
        op: "eq",
        right: "response-a",
      }),
    );
  });

  it("rejects a session VIEWER with 403 before reading raw hashes", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "session" as const,
      user_id: "viewer-user",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "OWNER", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request("/get?formId=form-a");

    expect(response.status).toBe(403);
    expect(mocks.fingerprintRows).not.toHaveBeenCalled();
  });

  it("rejects a session VIEWER with 403 before reading raw hashes when only responseId is provided", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "session" as const,
      user_id: "viewer-user",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "OWNER", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/get?responseId=response-a",
    );

    expect(response.status).toBe(403);
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "session",
        user_id: "viewer-user",
      }),
      "form-a",
      "OWNER",
    );
    expect(mocks.fingerprintRows).not.toHaveBeenCalled();
  });

  it("rejects a share-link VIEWER API token with 403 before reading raw hashes", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "api_token" as const,
      scopes: ["read"],
      share_link_id: "link-viewer",
      token_id: "tok-viewer",
      user_id: "share-link:link-viewer",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "OWNER", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request("/get?formId=form-a", {
      headers: { authorization: "Bearer share-link-viewer-token" },
    });

    expect(response.status).toBe(403);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "api_token",
        share_link_id: "link-viewer",
      }),
      "form-a",
      "OWNER",
    );
    expect(mocks.fingerprintRows).not.toHaveBeenCalled();
  });

  it("rejects a share-link VIEWER API token with 403 before reading raw hashes when only responseId is provided", async () => {
    const { InsufficientFormPermissionError } = await import(
      "../lib/errors/form-errors"
    );
    mocks.authContext.mockReturnValue({
      auth_type: "api_token" as const,
      scopes: ["read"],
      share_link_id: "link-viewer",
      token_id: "tok-viewer",
      user_id: "share-link:link-viewer",
    });
    mocks.checkFormPermissionLevel.mockRejectedValueOnce(
      new InsufficientFormPermissionError("form-a", "OWNER", "VIEWER"),
    );
    const { fingerprintRouter } = await import("../routes/fingerprint");

    const response = await fingerprintRouter.request(
      "/get?responseId=response-a",
      {
        headers: { authorization: "Bearer share-link-viewer-token" },
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.responseLimit).toHaveBeenCalledWith(1);
    expect(mocks.checkFormPermissionLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_type: "api_token",
        share_link_id: "link-viewer",
      }),
      "form-a",
      "OWNER",
    );
    expect(mocks.fingerprintRows).not.toHaveBeenCalled();
  });
});
