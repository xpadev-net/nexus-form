import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbInsert: vi.fn(),
  dbSelect: vi.fn(),
  dbTransaction: vi.fn(),
  dbUpdate: vi.fn(),
  txInsert: vi.fn(),
  txUpdate: vi.fn(),
  txInsertedRows: [] as Array<{ table: unknown; values: unknown }>,
  responseRows: [] as Array<{
    id: string;
    sessionId: string | null;
    respondentUuid: string;
    userAgent: string | null;
  }>,
  fingerprintRows: [] as Array<{
    responseId: string;
    fingerprintType: string;
    componentName: string;
    componentValue: string | null;
    componentValueHash: string;
  }>,
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: mocks.dbInsert,
    select: mocks.dbSelect,
    transaction: mocks.dbTransaction,
    update: mocks.dbUpdate,
  },
  fingerprintDetail: {
    responseId: "fingerprintDetail.responseId",
    fingerprintType: "fingerprintDetail.fingerprintType",
    componentName: "fingerprintDetail.componentName",
    componentValue: "fingerprintDetail.componentValue",
    componentValueHash: "fingerprintDetail.componentValueHash",
  },
  formResponse: {
    id: "formResponse.id",
    formId: "formResponse.formId",
    submittedAt: "formResponse.submittedAt",
    sessionId: "formResponse.sessionId",
    respondentUuid: "formResponse.respondentUuid",
    userAgent: "formResponse.userAgent",
  },
  responseLinkAnalysisRun: {
    id: "responseLinkAnalysisRun.id",
    formId: "responseLinkAnalysisRun.formId",
    modelVersion: "responseLinkAnalysisRun.modelVersion",
    status: "responseLinkAnalysisRun.status",
    completedAt: "responseLinkAnalysisRun.completedAt",
  },
  responsePairLink: "responsePairLink",
  responseSuspicionGroup: "responseSuspicionGroup",
  responseSuspicionGroupMember: "responseSuspicionGroupMember",
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
  desc: vi.fn((column: unknown) => ({ column, type: "desc" })),
  eq: vi.fn((column: unknown, value: unknown) => ({
    column,
    type: "eq",
    value,
  })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({
    column,
    type: "inArray",
    values,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: "sql",
    values,
  })),
}));

import { analyzeResponseLinks } from "../response-link-analysis";

function setupDbMocks() {
  const dbInsertValues = vi.fn().mockResolvedValue(undefined);
  mocks.dbInsert.mockReturnValue({ values: dbInsertValues });

  mocks.dbSelect.mockImplementation((selection: Record<string, unknown>) => {
    if ("fingerprintType" in selection) {
      const fingerprintQuery = {
        from: vi.fn(() => fingerprintQuery),
        where: vi.fn(async () => mocks.fingerprintRows),
      };
      return fingerprintQuery;
    }

    const query = {
      from: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => mocks.responseRows),
      where: vi.fn(() => query),
    };
    return query;
  });

  mocks.txInsert.mockImplementation((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      mocks.txInsertedRows.push({ table, values });
      return { table, values };
    }),
  }));
  mocks.txUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  });
  mocks.dbUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  });
  mocks.dbTransaction.mockImplementation(async (callback) =>
    callback({
      insert: mocks.txInsert,
      update: mocks.txUpdate,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.responseRows = [];
  mocks.fingerprintRows = [];
  mocks.txInsertedRows = [];
  setupDbMocks();
});

describe("analyzeResponseLinks", () => {
  it("persists a STRONG pair and group for matching v6 telemetry", async () => {
    mocks.responseRows = [
      {
        id: "response-a",
        sessionId: null,
        respondentUuid: "respondent-a",
        userAgent: null,
      },
      {
        id: "response-b",
        sessionId: null,
        respondentUuid: "respondent-b",
        userAgent: null,
      },
    ];
    mocks.fingerprintRows = [
      {
        responseId: "response-a",
        fingerprintType: "telemetry",
        componentName: "v6",
        componentValue: null,
        componentValueHash: "same-v6",
      },
      {
        responseId: "response-b",
        fingerprintType: "telemetry",
        componentName: "v6",
        componentValue: null,
        componentValueHash: "same-v6",
      },
    ];

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(1);
    expect(result.groupCount).toBe(1);
    const pairInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responsePairLink",
    );
    expect(pairInsert?.values).toEqual([
      expect.objectContaining({
        responseIdA: "response-a",
        responseIdB: "response-b",
        strength: "STRONG",
        v6Strong: true,
        breakdownJson: expect.objectContaining({
          reasonCodes: ["strong:telemetry:v6"],
        }),
      }),
    ]);
    const groupInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responseSuspicionGroup",
    );
    expect(groupInsert?.values).toEqual(
      expect.objectContaining({
        responseCount: 2,
        strongLinkCount: 1,
        supportLinkCount: 0,
        technicalConfidence: "STRONG",
      }),
    );
    const memberInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responseSuspicionGroupMember",
    );
    expect(memberInsert?.values).toEqual([
      expect.objectContaining({
        responseId: "response-a",
        strongestStrength: "STRONG",
        strongestEvidence: 0,
      }),
      expect.objectContaining({
        responseId: "response-b",
        strongestStrength: "STRONG",
        strongestEvidence: 0,
      }),
    ]);
  });

  it("does not drop oversized hard session buckets", async () => {
    mocks.responseRows = Array.from({ length: 201 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(20_100);
    expect(result.groupCount).toBe(1);
  });

  it("persists partial results when the candidate cap is exceeded", async () => {
    mocks.responseRows = Array.from({ length: 6 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1", {
      maxCandidatePairs: 10,
    });

    expect(result.linkCount).toBe(10);
    expect(result.groupCount).toBe(1);
    const pairInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responsePairLink",
    );
    expect(
      Array.isArray(pairInsert?.values) ? pairInsert.values : [],
    ).toHaveLength(10);
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: {
          candidatePairCount: 10,
          candidatePairLimit: 10,
          candidatePairsTruncated: true,
          responsePopulationLimit: 5000,
          responsePopulationTruncated: false,
          skippedCandidateBucketCount: 0,
        },
        status: "COMPLETED",
      }),
    );
  });

  it("marks the run as FAILED when analysis throws", async () => {
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => {
              throw new Error("database read failed");
            }),
          })),
        })),
      })),
    }));

    await expect(analyzeResponseLinks("form-1")).rejects.toThrow(
      "database read failed",
    );

    const updateSet = mocks.dbUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
  });
});
