import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      responseId: "externalServiceValidationResult.responseId",
      tableName: "externalServiceValidationResult",
    },
    fingerprintDetail: {
      responseId: "fingerprintDetail.responseId",
      tableName: "fingerprintDetail",
    },
    form: {
      id: "form.id",
      plateContent: "form.plateContent",
    },
    formResponse: {
      id: "formResponse.id",
      formId: "formResponse.formId",
      responseDataJson: "formResponse.responseDataJson",
      submittedAt: "formResponse.submittedAt",
      updatedAt: "formResponse.updatedAt",
      respondentUuid: "formResponse.respondentUuid",
      userAgent: "formResponse.userAgent",
      sessionId: "formResponse.sessionId",
      countryCode: "formResponse.countryCode",
      tableName: "formResponse",
    },
    formValidationRule: {},
    responseLinkAnalysisRun: {
      completedAt: "responseLinkAnalysisRun.completedAt",
      formId: "responseLinkAnalysisRun.formId",
      id: "responseLinkAnalysisRun.id",
      metadataJson: "responseLinkAnalysisRun.metadataJson",
      modelVersion: "responseLinkAnalysisRun.modelVersion",
      populationSize: "responseLinkAnalysisRun.populationSize",
      statsVersion: "responseLinkAnalysisRun.statsVersion",
      status: "responseLinkAnalysisRun.status",
      tableName: "responseLinkAnalysisRun",
    },
    responsePairLink: {
      responseIdA: "responsePairLink.responseIdA",
      responseIdB: "responsePairLink.responseIdB",
      runId: "responsePairLink.runId",
      strength: "responsePairLink.strength",
      tableName: "responsePairLink",
    },
    responseSuspicionGroup: {
      groupKey: "responseSuspicionGroup.groupKey",
      id: "responseSuspicionGroup.id",
      responseCount: "responseSuspicionGroup.responseCount",
      runId: "responseSuspicionGroup.runId",
      strongLinkCount: "responseSuspicionGroup.strongLinkCount",
      summaryJson: "responseSuspicionGroup.summaryJson",
      supportLinkCount: "responseSuspicionGroup.supportLinkCount",
      tableName: "responseSuspicionGroup",
      technicalConfidence: "responseSuspicionGroup.technicalConfidence",
    },
    responseSuspicionGroupMember: {
      groupId: "responseSuspicionGroupMember.groupId",
      responseId: "responseSuspicionGroupMember.responseId",
      tableName: "responseSuspicionGroupMember",
    },
  };

  return {
    authAllowed: true,
    db: {
      select: vi.fn(),
      transaction: vi.fn(),
      update: vi.fn(),
    },
    deleteTables: [] as string[],
    externalValidationResults: [] as Array<Record<string, unknown>>,
    formAuthRoles: [] as Array<unknown>,
    schema,
    tx: {
      delete: vi.fn(),
      update: vi.fn(),
    },
    whereConditions: [] as Array<unknown>,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {},
}));

vi.mock("@nexus-form/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexus-form/shared")>();
  const { z } = await import("zod");
  return {
    ...actual,
    responsePayloadItemSchema: z.object({}).passthrough(),
  };
});

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: (requiredRole?: unknown) => {
    mocks.formAuthRoles.push(requiredRole);
    return async (_c: unknown, next: () => Promise<void>) => {
      if (!mocks.authAllowed) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      await next();
    };
  },
}));

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContent: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(() => ({ isValid: true, errors: [] })),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshotByVersion: vi.fn(),
  getSnapshotByVersion: vi.fn(),
}));

vi.mock("../lib/forms/validation-results", () => ({
  getExternalValidationResults: vi.fn(() => mocks.externalValidationResults),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/queues", () => ({
  enqueueResponseLinkAnalysisJob: vi.fn(() => Promise.resolve()),
  getValidationQueue: vi.fn(),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/rate-limit", () => {
  const passThrough = async (
    _c: unknown,
    next: () => Promise<void>,
  ): Promise<void> => next();
  return { createRateLimit: () => passThrough };
});

vi.mock("../lib/request-body-size-limit", () => ({
  createRequestBodySizeLimit:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
}));

vi.mock("../lib/response-data-json", () => ({
  stringifyResponseDataJson: vi.fn(() => "[]"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  asc: vi.fn((field) => ({ op: "asc", field })),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
  ne: vi.fn((left, right) => ({ op: "ne", left, right })),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
  sql: vi.fn((strings) => ({
    as: vi.fn((alias: string) => ({ alias, strings })),
    toString: () => String(strings[0] ?? "sql"),
  })),
}));

function selectLimitQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push(condition);
      return query;
    }),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

function selectWhereQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push(condition);
      return Promise.resolve(result);
    }),
  };
  return query;
}

function selectSuspicionGroupsQuery(result: unknown[]) {
  let offset = 0;
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    offset: vi.fn((value: number) => {
      offset = value;
      return query;
    }),
    limit: vi.fn((value: number) =>
      Promise.resolve(result.slice(offset, offset + value)),
    ),
  };
  return query;
}

function deleteQuery(tableName: string) {
  return {
    where: vi.fn((condition: unknown) => {
      mocks.whereConditions.push({ tableName, condition });
      return Promise.resolve([{ affectedRows: 1 }]);
    }),
  };
}

function updateQuery(tableName: string) {
  return {
    set: vi.fn((values: unknown) => ({
      where: vi.fn((condition: unknown) => {
        mocks.whereConditions.push({ tableName, condition, values });
        return Promise.resolve([{ affectedRows: 1 }]);
      }),
    })),
  };
}

async function flushResponseLinkAnalysisSideEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function tableName(table: unknown): string {
  if (typeof table !== "object" || table === null) return "unknown";
  const value = Reflect.get(table, "tableName");
  return typeof value === "string" ? value : "unknown";
}

async function importRouter() {
  const { formsResponsesRouter } = await import("../routes/forms-responses");
  return formsResponsesRouter;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.authAllowed = true;
  mocks.deleteTables.length = 0;
  mocks.externalValidationResults.length = 0;
  mocks.formAuthRoles.length = 0;
  mocks.whereConditions.length = 0;
  mocks.db.select.mockReset();
  mocks.db.update.mockImplementation((table: unknown) =>
    updateQuery(tableName(table)),
  );
  mocks.db.transaction.mockImplementation(async (callback) =>
    callback(mocks.tx),
  );
  mocks.tx.delete.mockImplementation((table: unknown) => {
    const name = tableName(table);
    mocks.deleteTables.push(name);
    return deleteQuery(name);
  });
  mocks.tx.update.mockImplementation((table: unknown) =>
    updateQuery(tableName(table)),
  );
});

describe("response deletion API", () => {
  it("requires editor authorization before deleting a response", async () => {
    mocks.authAllowed = false;
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(mocks.formAuthRoles).toContain("EDITOR");
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("hard-deletes a response and its dependent hidden state", async () => {
    mocks.db.select.mockReturnValueOnce(
      selectLimitQuery([{ id: "response-1" }]),
    );
    const router = await importRouter();
    const { enqueueResponseLinkAnalysisJob } = await import("../lib/queues");

    const res = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    await flushResponseLinkAnalysisSideEffects();
    expect(mocks.deleteTables).toEqual([
      "fingerprintDetail",
      "externalServiceValidationResult",
      "formResponse",
    ]);
    expect(mocks.whereConditions).toContainEqual({
      tableName: "fingerprintDetail",
      condition: {
        op: "eq",
        left: "fingerprintDetail.responseId",
        right: "response-1",
      },
    });
    expect(mocks.whereConditions).toContainEqual({
      tableName: "externalServiceValidationResult",
      condition: {
        op: "eq",
        left: "externalServiceValidationResult.responseId",
        right: "response-1",
      },
    });
    expect(mocks.whereConditions).toContainEqual({
      tableName: "formResponse",
      condition: { op: "eq", left: "formResponse.id", right: "response-1" },
    });
    expect(mocks.whereConditions).not.toContainEqual(
      expect.objectContaining({
        tableName: "responseLinkAnalysisRun",
        values: { status: "STALE" },
      }),
    );
    expect(enqueueResponseLinkAnalysisJob).toHaveBeenCalledWith({
      formId: "form-1",
      reason: "response-deleted",
    });
  });

  it("keeps the previous response link analysis available when deletion requeue fails", async () => {
    mocks.db.select.mockReturnValueOnce(
      selectLimitQuery([{ id: "response-1" }]),
    );
    const router = await importRouter();
    const { enqueueResponseLinkAnalysisJob } = await import("../lib/queues");
    vi.mocked(enqueueResponseLinkAnalysisJob).mockRejectedValueOnce(
      new Error("queue unavailable"),
    );

    const res = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    await flushResponseLinkAnalysisSideEffects();
    expect(enqueueResponseLinkAnalysisJob).toHaveBeenCalledWith({
      formId: "form-1",
      reason: "response-deleted",
    });
    expect(mocks.whereConditions).not.toContainEqual(
      expect.objectContaining({
        tableName: "responseLinkAnalysisRun",
        values: { status: "STALE" },
      }),
    );
  });

  it("scans past stale suspicion groups with tied counts using a stable order", async () => {
    const staleGroups = Array.from({ length: 100 }, (_, index) => ({
      id: `stale-group-${String(index).padStart(3, "0")}`,
      groupKey: `stale-${index}`,
      technicalConfidence: "STRONG",
      responseCount: 2,
      strongLinkCount: 1,
      supportLinkCount: 0,
      summaryJson: { reasonCodes: ["stale"] },
    }));
    const liveGroup = {
      id: "live-group",
      groupKey: "live",
      technicalConfidence: "STRONG",
      responseCount: 2,
      strongLinkCount: 1,
      supportLinkCount: 0,
      summaryJson: { reasonCodes: ["session"] },
    };
    const suspicionGroupsQuery = selectSuspicionGroupsQuery([
      ...staleGroups,
      liveGroup,
    ]);
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            id: "run-1",
            formId: "form-1",
            modelVersion: "response-link-v2-rarity-shadow-agg-tier",
            statsVersion: "stats-1",
            populationSize: 2,
            status: "COMPLETED",
            startedAt: new Date("2026-07-29T00:00:00.000Z"),
            completedAt: new Date("2026-07-29T00:00:01.000Z"),
            errorMessage: null,
            metadataJson: {},
          },
        ]),
      )
      .mockReturnValueOnce(suspicionGroupsQuery)
      .mockReturnValueOnce(selectWhereQuery([]))
      .mockReturnValueOnce(suspicionGroupsQuery)
      .mockReturnValueOnce(
        selectWhereQuery([
          { groupId: "live-group", responseId: "response-1" },
          { groupId: "live-group", responseId: "response-2" },
        ]),
      )
      .mockReturnValueOnce(
        selectWhereQuery([
          {
            responseIdA: "response-1",
            responseIdB: "response-2",
            strength: "STRONG",
          },
        ]),
      );
    const router = await importRouter();

    const res = await router.request("/form-1/responses/suspicion-groups");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      groups: [
        {
          groupKey: "live",
          responseCount: 2,
          strongLinkCount: 1,
          supportLinkCount: 0,
        },
      ],
      hasNext: false,
    });
    expect(suspicionGroupsQuery.orderBy).toHaveBeenCalledWith(
      { op: "desc", field: "responseSuspicionGroup.responseCount" },
      { op: "desc", field: "responseSuspicionGroup.strongLinkCount" },
      { op: "asc", field: "responseSuspicionGroup.id" },
    );
    expect(suspicionGroupsQuery.offset).toHaveBeenNthCalledWith(1, 0);
    expect(suspicionGroupsQuery.offset).toHaveBeenNthCalledWith(2, 100);
  });

  it("does not double-count pair rows inside dense suspicion group aggregates", async () => {
    const denseGroup = {
      id: "dense-group",
      groupKey: "dense",
      technicalConfidence: "HARD",
      responseCount: 3,
      strongLinkCount: 3,
      supportLinkCount: 0,
      summaryJson: {
        denseBucket: {
          omittedPairLinks: true,
          pairCount: 3,
          reasonCode: "hard:session",
          strongPairCount: 3,
          supportPairCount: 0,
          strength: "HARD",
        },
        reasonCodes: ["hard:session", "dense:pair-links-omitted"],
      },
    };
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            id: "run-1",
            formId: "form-1",
            modelVersion: "response-link-v2-rarity-shadow-agg-tier",
            statsVersion: "stats-1",
            populationSize: 3,
            status: "COMPLETED",
            startedAt: new Date("2026-07-29T00:00:00.000Z"),
            completedAt: new Date("2026-07-29T00:00:01.000Z"),
            errorMessage: null,
            metadataJson: {},
          },
        ]),
      )
      .mockReturnValueOnce(selectSuspicionGroupsQuery([denseGroup]))
      .mockReturnValueOnce(
        selectWhereQuery([
          { groupId: "dense-group", responseId: "response-1" },
          { groupId: "dense-group", responseId: "response-2" },
          { groupId: "dense-group", responseId: "response-3" },
        ]),
      )
      .mockReturnValueOnce(
        selectWhereQuery([
          {
            responseIdA: "response-1",
            responseIdB: "response-2",
            strength: "STRONG",
          },
          {
            responseIdA: "response-2",
            responseIdB: "response-3",
            strength: "SUPPORT",
          },
        ]),
      );
    const router = await importRouter();

    const res = await router.request("/form-1/responses/suspicion-groups");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      groups: [
        {
          groupKey: "dense",
          responseCount: 3,
          strongLinkCount: 3,
          supportLinkCount: 0,
        },
      ],
    });
  });

  it("counts support dense suspicion group aggregates as support links", async () => {
    const denseGroup = {
      id: "dense-group",
      groupKey: "dense-support",
      technicalConfidence: "SUPPORT",
      responseCount: 3,
      strongLinkCount: 0,
      supportLinkCount: 3,
      summaryJson: {
        denseBucket: {
          omittedPairLinks: true,
          pairCount: 3,
          reasonCode: "support:visitorId",
          strongPairCount: 0,
          supportPairCount: 3,
          strength: "SUPPORT",
        },
        reasonCodes: ["support:visitorId", "dense:pair-links-omitted"],
      },
    };
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            id: "run-1",
            formId: "form-1",
            modelVersion: "response-link-v2-rarity-shadow-agg-tier",
            statsVersion: "stats-1",
            populationSize: 3,
            status: "COMPLETED",
            startedAt: new Date("2026-07-29T00:00:00.000Z"),
            completedAt: new Date("2026-07-29T00:00:01.000Z"),
            errorMessage: null,
            metadataJson: {},
          },
        ]),
      )
      .mockReturnValueOnce(selectSuspicionGroupsQuery([denseGroup]))
      .mockReturnValueOnce(
        selectWhereQuery([
          { groupId: "dense-group", responseId: "response-1" },
          { groupId: "dense-group", responseId: "response-2" },
          { groupId: "dense-group", responseId: "response-3" },
        ]),
      )
      .mockReturnValueOnce(selectWhereQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/suspicion-groups");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      groups: [
        {
          groupKey: "dense-support",
          responseCount: 3,
          strongLinkCount: 0,
          supportLinkCount: 3,
        },
      ],
    });
  });

  it("recomputes dense suspicion group counts from live members", async () => {
    const denseGroup = {
      id: "dense-group",
      groupKey: "dense-support-live",
      technicalConfidence: "SUPPORT",
      responseCount: 3,
      strongLinkCount: 0,
      supportLinkCount: 3,
      summaryJson: {
        denseBucket: {
          omittedPairLinks: true,
          pairCount: 3,
          reasonCode: "support:visitorId",
          strongPairCount: 0,
          supportPairCount: 3,
          strength: "SUPPORT",
        },
        reasonCodes: ["support:visitorId", "dense:pair-links-omitted"],
      },
    };
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            id: "run-1",
            formId: "form-1",
            modelVersion: "response-link-v2-rarity-shadow-agg-tier",
            statsVersion: "stats-1",
            populationSize: 3,
            status: "COMPLETED",
            startedAt: new Date("2026-07-29T00:00:00.000Z"),
            completedAt: new Date("2026-07-29T00:00:01.000Z"),
            errorMessage: null,
            metadataJson: {},
          },
        ]),
      )
      .mockReturnValueOnce(selectSuspicionGroupsQuery([denseGroup]))
      .mockReturnValueOnce(
        selectWhereQuery([
          { groupId: "dense-group", responseId: "response-1" },
          { groupId: "dense-group", responseId: "response-2" },
        ]),
      )
      .mockReturnValueOnce(selectWhereQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/suspicion-groups");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      groups: [
        {
          groupKey: "dense-support-live",
          responseCount: 2,
          strongLinkCount: 0,
          supportLinkCount: 1,
        },
      ],
    });
  });

  it("keeps merged hard and support dense counts in live aggregates", async () => {
    const denseGroup = {
      id: "dense-group",
      groupKey: "dense-merged",
      technicalConfidence: "HARD",
      responseCount: 3,
      strongLinkCount: 3,
      supportLinkCount: 3,
      summaryJson: {
        denseBucket: {
          omittedPairLinks: true,
          pairCount: 3,
          reasonCode: "hard:session",
          strongPairCount: 3,
          supportPairCount: 3,
          strength: "HARD",
        },
        reasonCodes: [
          "hard:session",
          "dense:pair-links-omitted",
          "support:respondentUuid",
        ],
      },
    };
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            id: "run-1",
            formId: "form-1",
            modelVersion: "response-link-v2-rarity-shadow-agg-tier",
            statsVersion: "stats-1",
            populationSize: 3,
            status: "COMPLETED",
            startedAt: new Date("2026-07-29T00:00:00.000Z"),
            completedAt: new Date("2026-07-29T00:00:01.000Z"),
            errorMessage: null,
            metadataJson: {},
          },
        ]),
      )
      .mockReturnValueOnce(selectSuspicionGroupsQuery([denseGroup]))
      .mockReturnValueOnce(
        selectWhereQuery([
          { groupId: "dense-group", responseId: "response-1" },
          { groupId: "dense-group", responseId: "response-2" },
          { groupId: "dense-group", responseId: "response-3" },
        ]),
      )
      .mockReturnValueOnce(selectWhereQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/suspicion-groups");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      groups: [
        {
          groupKey: "dense-merged",
          responseCount: 3,
          strongLinkCount: 3,
          supportLinkCount: 3,
        },
      ],
    });
  });

  it("queues response link analysis after bulk deletion", async () => {
    mocks.db.select.mockReturnValueOnce(
      selectWhereQuery([{ id: "response-1" }]),
    );
    const router = await importRouter();
    const { enqueueResponseLinkAnalysisJob } = await import("../lib/queues");

    const res = await router.request("/form-1/responses/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseIds: ["response-1", "missing"] }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      data: {
        deleted: 1,
        failed: 1,
      },
    });
    expect(enqueueResponseLinkAnalysisJob).toHaveBeenCalledWith({
      formId: "form-1",
      reason: "response-deleted",
    });
  });

  it("returns non-leaky not found for unknown or cross-form responses", async () => {
    mocks.db.select.mockReturnValueOnce(selectLimitQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-2/responses/response-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Response not found" });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.whereConditions).toContainEqual({
      op: "and",
      conditions: [
        { op: "eq", left: "formResponse.id", right: "response-1" },
        { op: "eq", left: "formResponse.formId", right: "form-2" },
      ],
    });
  });

  it("treats repeated deletes as not found after the hard delete commits", async () => {
    mocks.db.select
      .mockReturnValueOnce(selectLimitQuery([{ id: "response-1" }]))
      .mockReturnValueOnce(selectLimitQuery([]));
    const router = await importRouter();

    const first = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });
    const second = await router.request("/form-1/responses/response-1", {
      method: "DELETE",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("hides a deleted response from detail reads once the row is gone", async () => {
    mocks.db.select.mockReturnValueOnce(selectLimitQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Response not found" });
  });

  it("preserves validation output values through the response detail schema boundary", async () => {
    mocks.externalValidationResults.push({
      id: "validation-result-1",
      response_id: "response-1",
      rule_id: "rule-1",
      rule_name: "GitHub user",
      provider_name: "github",
      rule_type: "user_exists",
      referenced_block_id: "block-1",
      referenced_block_label: "GitHub username",
      referenced_block_missing: false,
      service: "github",
      status: "COMPLETED",
      success: true,
      attempt_count: 1,
      metadata: {
        validationOutputs: [
          { key: "username", label: "Username", value: "octocat" },
        ],
      },
      output_values: [
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: "42" },
      ],
      error_code: null,
      error_message: null,
      job_id: null,
      created_at: "2026-07-06T00:00:00.000Z",
      updated_at: "2026-07-06T00:00:01.000Z",
    });
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([
          {
            response: {
              id: "response-1",
              formId: "form-1",
              responseDataJson: "[]",
              submittedAt: new Date("2026-07-06T00:00:00.000Z"),
              updatedAt: null,
              respondentUuid: "respondent-1",
              userAgent: null,
              sessionId: null,
              countryCode: null,
            },
            plateContent: "[]",
          },
        ]),
      )
      .mockReturnValueOnce(selectLimitQuery([{ id: "response-1" }]))
      .mockReturnValueOnce(selectWhereQuery([]));
    const router = await importRouter();

    const res = await router.request("/form-1/responses/response-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.externalValidations[0].output_values).toEqual([
      { key: "username", label: "Username", value: "octocat" },
      { key: "followers", value: "42" },
    ]);
  });
});
