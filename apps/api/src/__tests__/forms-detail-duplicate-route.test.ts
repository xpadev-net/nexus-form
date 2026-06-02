import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

type TestAuthContext =
  | { auth_type: "session"; user_id: string }
  | {
      auth_type: "api_token";
      form_ids: string[];
      scopes: string[];
      share_link_id?: string;
      user_id: string;
    };

const mocks = vi.hoisted(() => ({
  authContext: {
    auth_type: "session",
    user_id: "user-1",
  } as TestAuthContext,
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  insertTables: [] as unknown[],
  insertValues: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  form: {
    allowEditResponses: "form.allowEditResponses",
    baseSnapshotVersion: "form.baseSnapshotVersion",
    creatorId: "form.creatorId",
    description: "form.description",
    id: "form.id",
    plateContent: "form.plateContent",
    plateContentVersion: "form.plateContentVersion",
    publicId: "form.publicId",
    status: "form.status",
    title: "form.title",
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: { shareLinkId: "apiToken.shareLinkId" },
  externalServiceValidationResult: {
    responseId: "externalServiceValidationResult.responseId",
  },
  fingerprintDetail: { responseId: "fingerprintDetail.responseId" },
  formIntegration: { formId: "formIntegration.formId" },
  formInvitation: { formId: "formInvitation.formId" },
  formPermission: {
    formId: "formPermission.formId",
    role: "formPermission.role",
    userId: "formPermission.userId",
  },
  formResponse: { formId: "formResponse.formId", id: "formResponse.id" },
  formSchedule: { formId: "formSchedule.formId" },
  formShareLink: {
    formId: "formShareLink.formId",
    id: "formShareLink.id",
  },
  formSnapshot: {
    formId: "formSnapshot.formId",
    isActive: "formSnapshot.isActive",
    version: "formSnapshot.version",
  },
  formStructure: {
    formId: "formStructure.formId",
    isActive: "formStructure.isActive",
    version: "formStructure.version",
  },
  formValidationRule: {
    formId: "formValidationRule.formId",
    id: "formValidationRule.id",
  },
  formValidationRuleBlock: {
    ruleId: "formValidationRuleBlock.ruleId",
  },
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", mocks.authContext);
      await next();
    };
  },
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: vi.fn(),
}));

vi.mock("../lib/forms/schedule-error-logging", () => ({
  logFormScheduleError: vi.fn(),
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: vi.fn(),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: vi.fn(),
}));

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
}));

function makeFormRow(overrides: Record<string, unknown> = {}) {
  return {
    allowEditResponses: true,
    baseSnapshotVersion: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    creatorId: "user-1",
    description: "説明",
    id: "form-1",
    plateContent: "[]",
    plateContentVersion: 3,
    publicId: "public-1",
    publishedAt: new Date("2026-06-01T01:00:00.000Z"),
    status: "PUBLISHED",
    title: "応募フォーム",
    unpublishedAt: null,
    updatedAt: new Date("2026-06-01T02:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

function makeDbSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    where: vi.fn().mockReturnThis(),
  };
}

function makeTxLimitSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  };
}

function makeTxWhereSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
}

describe("POST /:id/duplicate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.insertTables.length = 0;
    mocks.authContext = {
      auth_type: "session",
      user_id: "user-1",
    };
    mocks.randomUUID
      .mockReturnValueOnce("new-form-id")
      .mockReturnValueOnce("new-public-id");

    const createdForm = makeFormRow({
      baseSnapshotVersion: null,
      id: "new-form-id",
      publicId: "new-public-id",
      publishedAt: null,
      status: "DRAFT",
      title: "応募フォーム のコピー",
    });

    mocks.db.select
      .mockReturnValueOnce(makeDbSelectChain([makeFormRow()]))
      .mockReturnValueOnce(makeDbSelectChain([createdForm]));

    const txSelectChains = [
      makeTxLimitSelectChain([]),
      makeTxWhereSelectChain([]),
      makeTxLimitSelectChain([]),
    ];
    const tx = {
      insert: vi.fn((table: unknown) => {
        mocks.insertTables.push(table);
        return {
          values: mocks.insertValues.mockResolvedValue(undefined),
        };
      }),
      select: vi.fn(() => {
        const nextChain = txSelectChains.shift();
        if (!nextChain) {
          throw new Error("Unexpected tx.select call");
        }
        return nextChain;
      }),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
  });

  it("creates a draft copy with an explicit duplicate policy response", async () => {
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request("/form-1/duplicate", {
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      copyPolicy: {
        publishedStatus: false,
        responses: false,
        sharingSettings: false,
        structureAndValidation: true,
        title: "renamed",
      },
      form: {
        id: "new-form-id",
        publicId: "new-public-id",
        status: "DRAFT",
        title: "応募フォーム のコピー",
      },
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEditResponses: true,
        creatorId: "user-1",
        id: "new-form-id",
        publicId: "new-public-id",
        status: "DRAFT",
        title: "応募フォーム のコピー",
      }),
    );
    expect(mocks.insertTables).toHaveLength(1);
  });

  it("rejects share-link token principals because they cannot own duplicated forms", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      form_ids: ["form-1"],
      scopes: ["write"],
      share_link_id: "share-link-id",
      user_id: "share-link:share-link-id",
    };
    const { formsDetailRouter } = await import("../routes/forms-detail");

    const response = await formsDetailRouter.request("/form-1/duplicate", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Insufficient permissions",
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });
});
