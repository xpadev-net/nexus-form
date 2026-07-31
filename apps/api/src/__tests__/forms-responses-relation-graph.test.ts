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
      countryCode: "formResponse.countryCode",
      formId: "formResponse.formId",
      id: "formResponse.id",
      respondentUuid: "formResponse.respondentUuid",
      responseDataJson: "formResponse.responseDataJson",
      sessionId: "formResponse.sessionId",
      submittedAt: "formResponse.submittedAt",
      tableName: "formResponse",
      updatedAt: "formResponse.updatedAt",
      userAgent: "formResponse.userAgent",
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
      breakdownJson: "responsePairLink.breakdownJson",
      deviceEvidence: "responsePairLink.deviceEvidence",
      responseIdA: "responsePairLink.responseIdA",
      responseIdB: "responsePairLink.responseIdB",
      runId: "responsePairLink.runId",
      stateSupport: "responsePairLink.stateSupport",
      strength: "responsePairLink.strength",
      tableName: "responsePairLink",
      v4Support: "responsePairLink.v4Support",
      v6Strong: "responsePairLink.v6Strong",
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
    db: {
      select: vi.fn(),
    },
    limitCalls: [] as number[],
    orderByCalls: [] as unknown[][],
    schema,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {},
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth:
    () =>
    (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ): Promise<void> => {
      c.set("auth", { role: "EDITOR", userId: "user-1" });
      return next();
    },
}));

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContent: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(() => ({ errors: [], isValid: true })),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshotByVersion: vi.fn(),
  getSnapshotByVersion: vi.fn(),
}));

vi.mock("../lib/forms/validation-results", () => ({
  getExternalValidationResults: vi.fn(() => []),
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

vi.mock("../lib/rate-limit", () => ({
  createRateLimit:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
}));

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
  and: vi.fn((...conditions) => ({ conditions, op: "and" })),
  asc: vi.fn((field) => ({ field, op: "asc" })),
  desc: vi.fn((field) => ({ field, op: "desc" })),
  eq: vi.fn((left, right) => ({ left, op: "eq", right })),
  inArray: vi.fn((left, values) => ({ left, op: "inArray", values })),
  ne: vi.fn((left, right) => ({ left, op: "ne", right })),
  or: vi.fn((...conditions) => ({ conditions, op: "or" })),
  sql: vi.fn((strings) => ({
    as: vi.fn((alias: string) => ({ alias, strings })),
    toString: () => String(strings[0] ?? "sql"),
  })),
}));

function selectQuery<T>(rows: T[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    limit: vi.fn((value: number) => {
      mocks.limitCalls.push(value);
      return Promise.resolve(rows);
    }),
    orderBy: vi.fn((...orders: unknown[]) => {
      mocks.orderByCalls.push(orders);
      return query;
    }),
    where: vi.fn(() => query),
  };
  return query;
}

function selectWhereTerminalQuery<T>(rows: T[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return query;
}

const completedRun = {
  completedAt: new Date("2026-07-30T00:00:00.000Z"),
  id: "run-1",
  metadataJson: {
    candidatePairLimitExceeded: false,
    skippedCandidateBucketCount: 0,
  },
  modelVersion: "response-link-v2-rarity-shadow-agg-tier",
  populationSize: 5,
  statsVersion: "stats-1",
};

function responseRow(id: string, index: number) {
  return {
    id,
    respondentUuid: `respondent-${id}`,
    submittedAt: new Date(Date.UTC(2026, 6, 30, 0, 0, index)),
  };
}

async function requestRelationGraph() {
  const { formsResponsesRouter } = await import("../routes/forms-responses");
  const res = await formsResponsesRouter.request(
    "/form-1/responses/relation-graph",
  );
  expect(res.status).toBe(200);
  return res.json();
}

describe("formsResponsesRouter relation graph", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.limitCalls.length = 0;
    mocks.orderByCalls.length = 0;
  });

  it("returns an empty graph when no completed response-link run exists", async () => {
    mocks.db.select.mockReturnValueOnce(selectQuery([]));

    await expect(requestRelationGraph()).resolves.toMatchObject({
      denseClusters: [],
      edges: [],
      hasNextEdges: false,
      hasNextNodes: false,
      nodes: [],
      run: null,
    });
  });

  it("merges strongest node strength and builds dense clusters in stable order", async () => {
    mocks.db.select
      .mockReturnValueOnce(selectQuery([completedRun]))
      .mockReturnValueOnce(
        selectQuery([
          {
            breakdownJson: {
              familyContributions: [
                {
                  family: "composite",
                  reasonCodes: ["match:visitorId"],
                  score: 1,
                },
              ],
              reasonCodes: ["strong:telemetry:v6"],
            },
            deviceEvidence: 0.25,
            responseIdA: "response-a",
            responseIdB: "response-c",
            stateSupport: false,
            strength: "STRONG",
            v4Support: false,
            v6Strong: true,
          },
          {
            breakdownJson: {
              familyContributions: [],
              reasonCodes: ["support:device"],
            },
            deviceEvidence: 0.7,
            responseIdA: "response-a",
            responseIdB: "response-b",
            stateSupport: false,
            strength: "SUPPORT",
            v4Support: false,
            v6Strong: false,
          },
        ]),
      )
      .mockReturnValueOnce(
        selectQuery([
          {
            groupKey: "dense-key",
            id: "group-1",
            responseCount: 3,
            summaryJson: {
              denseBucket: {
                omittedPairLinks: true,
                pairCount: 3,
                reasonCode: "dense:pair-links-omitted",
                strength: "SUPPORT",
              },
            },
            technicalConfidence: "SUPPORT",
          },
        ]),
      )
      .mockReturnValueOnce(
        selectQuery([
          { groupId: "group-1", responseId: "response-d" },
          { groupId: "group-1", responseId: "response-e" },
        ]),
      )
      .mockReturnValueOnce(
        selectWhereTerminalQuery([
          responseRow("response-e", 5),
          responseRow("response-c", 3),
          responseRow("response-a", 1),
          responseRow("response-d", 4),
          responseRow("response-b", 2),
        ]),
      );

    const body = await requestRelationGraph();

    expect(
      body.nodes.map((node: { responseId: string }) => node.responseId),
    ).toEqual([
      "response-a",
      "response-c",
      "response-b",
      "response-d",
      "response-e",
    ]);
    expect(body.nodes[0]).toMatchObject({
      responseId: "response-a",
      strongestEvidence: 0.7,
      strongestStrength: "STRONG",
    });
    expect(body.edges).toMatchObject([
      {
        reasonCodes: ["strong:telemetry:v6"],
        responseIdA: "response-a",
        responseIdB: "response-c",
        strength: "STRONG",
        v6Strong: true,
      },
      {
        reasonCodes: ["support:device"],
        responseIdA: "response-a",
        responseIdB: "response-b",
        strength: "SUPPORT",
      },
    ]);
    expect(body.denseClusters).toEqual([
      {
        id: "dense-key",
        pairCount: 3,
        reasonCode: "dense:pair-links-omitted",
        responseIds: ["response-d", "response-e"],
        strength: "SUPPORT",
      },
    ]);
    expect(mocks.orderByCalls).toContainEqual([
      { field: "responseSuspicionGroupMember.groupId", op: "asc" },
      { field: "responseSuspicionGroupMember.responseId", op: "asc" },
    ]);
  });

  it("reports node and edge truncation at graph limits", async () => {
    const edges = Array.from({ length: 1001 }, (_, index) => ({
      breakdownJson: { reasonCodes: ["support:device"] },
      deviceEvidence: 0.1,
      responseIdA: `response-${String(index).padStart(4, "0")}`,
      responseIdB: `response-${String(index + 1).padStart(4, "0")}`,
      stateSupport: false,
      strength: "SUPPORT",
      v4Support: false,
      v6Strong: false,
    }));
    const responses = Array.from({ length: 300 }, (_, index) =>
      responseRow(`response-${String(index).padStart(4, "0")}`, index),
    );

    mocks.db.select
      .mockReturnValueOnce(selectQuery([completedRun]))
      .mockReturnValueOnce(selectQuery(edges))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectWhereTerminalQuery(responses));

    const body = await requestRelationGraph();

    expect(body.nodes).toHaveLength(300);
    expect(body.edges).toHaveLength(299);
    expect(body.hasNextNodes).toBe(true);
    expect(body.hasNextEdges).toBe(true);
    expect(mocks.limitCalls).toEqual(expect.arrayContaining([1, 1001, 100]));
  });
});
