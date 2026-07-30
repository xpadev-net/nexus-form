import type { ResponseLinkAnalysisJobData } from "@nexus-form/shared";
import type { Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbInsert: vi.fn(),
  dbDelete: vi.fn(),
  dbSelect: vi.fn(),
  dbTransaction: vi.fn(),
  dbUpdate: vi.fn(),
  dbDeletedTables: [] as unknown[],
  dbUpdatedTables: [] as unknown[],
  txInsert: vi.fn(),
  txUpdate: vi.fn(),
  txInsertedRows: [] as Array<{ table: unknown; values: unknown }>,
  txUpdatedRows: [] as Array<{
    table: unknown;
    values: unknown;
    condition: unknown;
  }>,
  queueClose: vi.fn(async () => undefined),
  queueAdd: vi.fn(async () => undefined),
  queueGetJob: vi.fn(async (): Promise<unknown> => null),
  redisDel: vi.fn(async () => 0),
  redisEval: vi.fn(async () => 0),
  redisGet: vi.fn(async () => null as string | null),
  redisScan: vi.fn(async () => ["0", []] as [string, string[]]),
  redisQuit: vi.fn(async () => "OK"),
  queueOptions: [] as unknown[],
  staleRunRows: [] as Array<{ id: string }>,
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

vi.mock("bullmq", () => ({
  Queue: vi.fn(function queueMock(_name: string, options?: unknown) {
    mocks.queueOptions.push(options);
    return {
      add: mocks.queueAdd,
      close: mocks.queueClose,
      getJob: mocks.queueGetJob,
      options,
    };
  }),
}));

vi.mock("ioredis", () => ({
  default: vi.fn(function redisMock() {
    return {
      del: mocks.redisDel,
      eval: mocks.redisEval,
      get: mocks.redisGet,
      scan: mocks.redisScan,
      quit: mocks.redisQuit,
    };
  }),
}));

vi.mock("../lib/redis", () => ({
  getPublisherConnectionOptions: vi.fn(() => ({ id: "publisher-redis" })),
  redisConnection: { id: "worker-redis" },
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: mocks.dbInsert,
    select: mocks.dbSelect,
    transaction: mocks.dbTransaction,
    update: mocks.dbUpdate,
    delete: mocks.dbDelete,
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
  responseLinkAnalysisLock: {
    formId: "responseLinkAnalysisLock.formId",
    jobId: "responseLinkAnalysisLock.jobId",
    lockedAt: "responseLinkAnalysisLock.lockedAt",
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
  ne: vi.fn((column: unknown, value: unknown) => ({
    column,
    type: "ne",
    value,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: "sql",
    values,
  })),
}));

import {
  analyzeResponseLinks,
  closeResponseLinkAnalysisResources,
  handleResponseLinkAnalysis,
  sweepResponseLinkAnalysisDirtyMarkers,
} from "../response-link-analysis";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function setupDbMocks() {
  const dbInsertValues = vi.fn().mockResolvedValue(undefined);
  mocks.dbInsert.mockReturnValue({ values: dbInsertValues });
  mocks.dbDelete.mockImplementation((table: unknown) => ({
    where: vi.fn(async () => {
      mocks.dbDeletedTables.push(table);
      return undefined;
    }),
  }));

  mocks.dbSelect.mockImplementation((selection: Record<string, unknown>) => {
    if ("fingerprintType" in selection) {
      const fingerprintQuery = {
        from: vi.fn(() => fingerprintQuery),
        where: vi.fn(async () => mocks.fingerprintRows),
      };
      return fingerprintQuery;
    }
    if (
      "id" in selection &&
      !("sessionId" in selection) &&
      !("respondentUuid" in selection)
    ) {
      const staleRunQuery = {
        from: vi.fn(() => staleRunQuery),
        where: vi.fn(async () => mocks.staleRunRows),
      };
      return staleRunQuery;
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
  mocks.txUpdate.mockImplementation((table: unknown) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(async (condition: unknown) => {
        mocks.txUpdatedRows.push({ table, values, condition });
        return undefined;
      }),
    })),
  }));
  mocks.dbUpdate.mockImplementation((table: unknown) => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => {
        mocks.dbUpdatedTables.push(table);
        return undefined;
      }),
    })),
  }));
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
  mocks.staleRunRows = [];
  mocks.dbDeletedTables = [];
  mocks.dbUpdatedTables = [];
  mocks.txInsertedRows = [];
  mocks.txUpdatedRows = [];
  mocks.queueAdd.mockClear();
  mocks.queueClose.mockClear();
  mocks.queueGetJob.mockClear();
  mocks.queueOptions = [];
  mocks.redisQuit.mockClear();
  mocks.redisDel.mockReset();
  mocks.redisDel.mockResolvedValue(0);
  mocks.redisEval.mockReset();
  mocks.redisEval.mockResolvedValue(0);
  mocks.redisGet.mockReset();
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisScan.mockReset();
  mocks.redisScan.mockResolvedValue(["0", []]);
  setupDbMocks();
});

afterEach(async () => {
  await closeResponseLinkAnalysisResources();
  vi.useRealTimers();
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
    expect(mocks.txUpdatedRows).toContainEqual({
      table: expect.objectContaining({ id: "responseLinkAnalysisRun.id" }),
      values: { status: "STALE" },
      condition: expect.objectContaining({
        conditions: expect.arrayContaining([
          {
            column: "responseLinkAnalysisRun.formId",
            type: "eq",
            value: "form-1",
          },
          {
            column: "responseLinkAnalysisRun.modelVersion",
            type: "eq",
            value: "response-link-v2-rarity-shadow",
          },
          {
            column: "responseLinkAnalysisRun.status",
            type: "eq",
            value: "COMPLETED",
          },
          {
            column: "responseLinkAnalysisRun.id",
            type: "ne",
            value: result.runId,
          },
        ]),
        type: "and",
      }),
    });
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

  it("keeps high-confidence session buckets complete even past the lower-confidence candidate cap", async () => {
    mocks.responseRows = Array.from({ length: 6 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1", {
      maxCandidatePairs: 10,
    });

    expect(result.linkCount).toBe(15);
    expect(result.groupCount).toBe(1);
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          candidatePairLimitExceeded: false,
          skippedCandidateBucketCount: 0,
        }),
        status: "COMPLETED",
      }),
    );
  });

  it("persists every pair in oversized high-confidence buckets", async () => {
    mocks.responseRows = Array.from({ length: 317 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(50_086);
    expect(result.groupCount).toBe(1);
    const pairInsertValues = mocks.txInsertedRows
      .filter((entry) => entry.table === "responsePairLink")
      .flatMap((entry) => (Array.isArray(entry.values) ? entry.values : []));
    expect(pairInsertValues).toHaveLength(50_086);
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          candidatePairLimitExceeded: false,
          skippedCandidateBucketCount: 0,
        }),
        status: "COMPLETED",
      }),
    );
  });

  it("persists extreme high-confidence buckets as dense groups without partial pairs", async () => {
    mocks.responseRows = Array.from({ length: 1002 }, (_, index) => ({
      id: `response-${index.toString().padStart(4, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(1);
    const pairInsertValues = mocks.txInsertedRows
      .filter((entry) => entry.table === "responsePairLink")
      .flatMap((entry) => (Array.isArray(entry.values) ? entry.values : []));
    expect(pairInsertValues).toHaveLength(0);
    const groupInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responseSuspicionGroup",
    );
    expect(groupInsert?.values).toEqual(
      expect.objectContaining({
        responseCount: 1002,
        strongLinkCount: 501_501,
        supportLinkCount: 0,
        technicalConfidence: "HARD",
        summaryJson: expect.objectContaining({
          denseBucket: expect.objectContaining({
            omittedPairLinks: true,
            pairCount: 501_501,
            reasonCode: "hard:session",
            strongPairCount: 501_501,
            supportPairCount: 0,
            strength: "HARD",
          }),
          reasonCodes: ["hard:session", "dense:pair-links-omitted"],
        }),
      }),
    );
    const memberInsertValues = mocks.txInsertedRows
      .filter((entry) => entry.table === "responseSuspicionGroupMember")
      .flatMap((entry) => (Array.isArray(entry.values) ? entry.values : []));
    expect(memberInsertValues).toHaveLength(1002);
    expect(memberInsertValues[0]).toEqual(
      expect.objectContaining({ strongestStrength: "HARD" }),
    );
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          candidatePairLimitExceeded: true,
          skippedCandidateBucketCount: 0,
        }),
        status: "COMPLETED",
      }),
    );
  });

  it("merges overlapping dense session and v6 buckets into one group", async () => {
    mocks.responseRows = Array.from({ length: 1002 }, (_, index) => ({
      id: `response-${index.toString().padStart(4, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));
    mocks.fingerprintRows = mocks.responseRows.map((response) => ({
      responseId: response.id,
      fingerprintType: "telemetry",
      componentName: "v6",
      componentValue: null,
      componentValueHash: "same-v6",
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(1);
    const groupInsertValues = mocks.txInsertedRows
      .filter((entry) => entry.table === "responseSuspicionGroup")
      .map((entry) => entry.values);
    expect(groupInsertValues).toHaveLength(1);
    expect(groupInsertValues[0]).toEqual(
      expect.objectContaining({
        responseCount: 1002,
        strongLinkCount: 501_501,
        technicalConfidence: "HARD",
        summaryJson: expect.objectContaining({
          reasonCodes: [
            "hard:session",
            "dense:pair-links-omitted",
            "strong:telemetry:v6",
          ],
        }),
      }),
    );
  });

  it("persists extreme visitorId buckets as support dense groups", async () => {
    mocks.responseRows = Array.from({ length: 1002 }, (_, index) => ({
      id: `response-${index.toString().padStart(4, "0")}`,
      sessionId: null,
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));
    mocks.fingerprintRows = mocks.responseRows.map((response) => ({
      responseId: response.id,
      fingerprintType: "fingerprintjs",
      componentName: "visitorId",
      componentValue: null,
      componentValueHash: "same-visitor",
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(1);
    const groupInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responseSuspicionGroup",
    );
    expect(groupInsert?.values).toEqual(
      expect.objectContaining({
        responseCount: 1002,
        strongLinkCount: 0,
        supportLinkCount: 501_501,
        technicalConfidence: "SUPPORT",
        summaryJson: expect.objectContaining({
          denseBucket: expect.objectContaining({
            omittedPairLinks: true,
            pairCount: 501_501,
            reasonCode: "support:visitorId",
            strongPairCount: 0,
            supportPairCount: 501_501,
            strength: "SUPPORT",
          }),
          reasonCodes: ["support:visitorId", "dense:pair-links-omitted"],
        }),
      }),
    );
    const memberInsertValues = mocks.txInsertedRows
      .filter((entry) => entry.table === "responseSuspicionGroupMember")
      .flatMap((entry) => (Array.isArray(entry.values) ? entry.values : []));
    expect(memberInsertValues[0]).toEqual(
      expect.objectContaining({ strongestStrength: "SUPPORT" }),
    );
  });

  it("persists extreme respondent UUID buckets as support dense groups", async () => {
    mocks.responseRows = Array.from({ length: 1002 }, (_, index) => ({
      id: `response-${index.toString().padStart(4, "0")}`,
      sessionId: null,
      respondentUuid: "same-respondent",
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(1);
    const groupInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responseSuspicionGroup",
    );
    expect(groupInsert?.values).toEqual(
      expect.objectContaining({
        responseCount: 1002,
        strongLinkCount: 0,
        supportLinkCount: 501_501,
        technicalConfidence: "SUPPORT",
        summaryJson: expect.objectContaining({
          denseBucket: expect.objectContaining({
            omittedPairLinks: true,
            pairCount: 501_501,
            reasonCode: "support:respondentUuid",
            strongPairCount: 0,
            supportPairCount: 501_501,
            strength: "SUPPORT",
          }),
          reasonCodes: ["support:respondentUuid", "dense:pair-links-omitted"],
        }),
      }),
    );
  });

  it("preserves support counts when dense support evidence overlaps a hard dense group", async () => {
    mocks.responseRows = Array.from({ length: 1002 }, (_, index) => ({
      id: `response-${index.toString().padStart(4, "0")}`,
      sessionId: "same-session",
      respondentUuid: "same-respondent",
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1");

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(1);
    const groupInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responseSuspicionGroup",
    );
    expect(groupInsert?.values).toEqual(
      expect.objectContaining({
        responseCount: 1002,
        strongLinkCount: 501_501,
        supportLinkCount: 501_501,
        technicalConfidence: "HARD",
        summaryJson: expect.objectContaining({
          denseBucket: expect.objectContaining({
            pairCount: 501_501,
            strongPairCount: 501_501,
            supportPairCount: 501_501,
            strength: "HARD",
          }),
          reasonCodes: [
            "hard:session",
            "dense:pair-links-omitted",
            "support:respondentUuid",
          ],
        }),
      }),
    );
  });

  it("completes the run and skips lower-confidence buckets that would exceed the candidate cap", async () => {
    mocks.responseRows = Array.from({ length: 6 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: null,
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));
    mocks.fingerprintRows = mocks.responseRows.map((response) => ({
      responseId: response.id,
      fingerprintType: "telemetry",
      componentName: "v4",
      componentValue: null,
      componentValueHash: "same-v4",
    }));

    const result = await analyzeResponseLinks("form-1", {
      maxCandidatePairs: 10,
    });

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(0);
    const pairInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responsePairLink",
    );
    expect(pairInsert).toBeUndefined();
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          candidatePairLimitExceeded: true,
          skippedCandidateBucketCount: 1,
        }),
        status: "COMPLETED",
      }),
    );
  });

  it("does not let earlier bounded buckets consume later bucket capacity", async () => {
    mocks.responseRows = Array.from({ length: 8 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: null,
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));
    mocks.fingerprintRows = mocks.responseRows.map((response, index) => ({
      responseId: response.id,
      fingerprintType: "telemetry",
      componentName: "v4",
      componentValue: null,
      componentValueHash: index < 4 ? "same-v4-a" : "same-v4-b",
    }));

    const result = await analyzeResponseLinks("form-1", {
      maxCandidatePairs: 10,
    });

    expect(result.linkCount).toBe(12);
    expect(result.groupCount).toBe(0);
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          candidatePairCount: 12,
          candidatePairLimitExceeded: false,
          skippedCandidateBucketCount: 0,
        }),
        status: "COMPLETED",
      }),
    );
  });

  it("does not double-count overlapping bucket pairs against the candidate cap", async () => {
    mocks.responseRows = Array.from({ length: 5 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: "same-session",
      respondentUuid: "same-respondent",
      userAgent: null,
    }));

    const result = await analyzeResponseLinks("form-1", {
      maxCandidatePairs: 10,
    });

    expect(result.linkCount).toBe(10);
    expect(result.groupCount).toBe(1);
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMPLETED" }),
    );
  });

  it("completes a bounded degraded run when only oversized popular buckets are skipped", async () => {
    mocks.responseRows = Array.from({ length: 201 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: null,
      respondentUuid: `respondent-${index}`,
      userAgent: "same-user-agent",
    }));

    const result = await analyzeResponseLinks("form-1", {
      maxCandidatePairs: 10,
    });

    expect(result.linkCount).toBe(0);
    expect(result.groupCount).toBe(0);
    const pairInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responsePairLink",
    );
    expect(pairInsert).toBeUndefined();
    const updateSet = mocks.txUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          candidatePairLimitExceeded: false,
          skippedCandidateBucketCount: 1,
        }),
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

describe("handleResponseLinkAnalysis", () => {
  it("sweeps dirty markers into dirty rescue jobs that consume the marker", async () => {
    mocks.redisScan.mockResolvedValueOnce([
      "0",
      [
        "response-link-analysis:dirty:form-1",
        "response-link-analysis:dirty:",
        "unrelated:key",
      ],
    ]);

    const sweptCount = await sweepResponseLinkAnalysisDirtyMarkers();

    expect(sweptCount).toBe(1);
    const queueAddCalls = mocks.queueAdd.mock.calls as unknown[][];
    const addOptions = queueAddCalls[0]?.[2];
    if (!isRecord(addOptions) || typeof addOptions.jobId !== "string") {
      throw new Error("Expected dirty rescue job options with a jobId");
    }
    expect(addOptions).toEqual({
      delay: 10_000,
      jobId: expect.stringMatching(
        /^response-link-analysis\.form-1\.dirty\.\d+$/,
      ),
    });
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "response-submitted",
      { formId: "form-1", reason: "response-submitted" },
      addOptions,
    );

    await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "response-submitted" },
      id: addOptions.jobId,
    } as Job<ResponseLinkAnalysisJobData>);

    expect(mocks.redisDel).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
    );
  });

  it("serializes analysis with a form lock and purges stale run children", async () => {
    mocks.staleRunRows = [{ id: "stale-run-1" }];

    const result = await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(result.linkCount).toBe(0);
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedAt: "responseLinkAnalysisLock.lockedAt",
      }),
    );
    expect(mocks.dbDeletedTables).toEqual([
      expect.objectContaining({ formId: "responseLinkAnalysisLock.formId" }),
      "responseSuspicionGroupMember",
      "responsePairLink",
      "responseSuspicionGroup",
      expect.objectContaining({ id: "responseLinkAnalysisRun.id" }),
      expect.objectContaining({ formId: "responseLinkAnalysisLock.formId" }),
    ]);
  });

  it("queues a fixed follow-up after consuming a dirty response-link marker", async () => {
    mocks.redisGet.mockResolvedValueOnce("marker-1");

    const result = await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(result.linkCount).toBe(0);
    expect(mocks.redisDel).not.toHaveBeenCalled();
    expect(mocks.redisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1]) == ARGV[1]"),
      1,
      "response-link-analysis:dirty:form-1",
      "marker-1",
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "response-submitted",
      { formId: "form-1", reason: "response-submitted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.follow-up",
      },
    );
  });

  it("uses response-link retry defaults for dirty follow-up queueing", async () => {
    mocks.redisGet.mockResolvedValueOnce("marker-1");

    await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(mocks.queueOptions[0]).toMatchObject({
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 60_000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  });

  it("closes response-link helper queue and Redis resources", async () => {
    mocks.redisGet.mockResolvedValueOnce("marker-1");

    await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);
    await closeResponseLinkAnalysisResources();

    expect(mocks.queueClose).toHaveBeenCalledTimes(1);
    expect(mocks.redisQuit).toHaveBeenCalledTimes(1);
  });

  it("leaves dirty marker when fixed follow-up queueing fails", async () => {
    mocks.redisGet.mockResolvedValueOnce("marker-1");
    mocks.queueAdd.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      handleResponseLinkAnalysis({
        data: { formId: "form-1", reason: "manual" },
        id: "job-1",
      } as Job<ResponseLinkAnalysisJobData>),
    ).rejects.toThrow("queue unavailable");

    expect(mocks.redisDel).not.toHaveBeenCalled();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });

  it("leaves dirty marker when the fixed follow-up is already active", async () => {
    mocks.redisGet.mockResolvedValueOnce("marker-1");
    mocks.queueGetJob.mockResolvedValueOnce({
      getState: vi.fn(async () => "active"),
      remove: vi.fn(async () => undefined),
    });

    const result = await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(result.linkCount).toBe(0);
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "response-submitted",
      { formId: "form-1", reason: "response-submitted" },
      {
        delay: 10_000,
        jobId: "response-link-analysis.form-1.follow-up",
      },
    );
    expect(mocks.redisDel).not.toHaveBeenCalled();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });

  it("consumes the marker before analyzing a dirty rescue job", async () => {
    const result = await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "response-submitted" },
      id: "response-link-analysis.form-1.dirty.178528321",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(result.linkCount).toBe(0);
    expect(mocks.redisDel).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
    );
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });

  it("runs dirty rescue jobs even when the marker was already consumed", async () => {
    const result = await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "response-submitted" },
      id: "response-link-analysis.form-1.dirty.178528321",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(result.linkCount).toBe(0);
    expect(mocks.dbInsert).toHaveBeenCalledTimes(2);
    expect(mocks.dbSelect).toHaveBeenCalledTimes(2);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("refreshes the form lock heartbeat while analysis is running", async () => {
    vi.useFakeTimers();
    let releaseResponseLoad: () => void = () => undefined;
    const responseLoadBlocker = new Promise<void>((resolve) => {
      releaseResponseLoad = resolve;
    });
    mocks.dbSelect.mockImplementation((selection: Record<string, unknown>) => {
      if ("fingerprintType" in selection) {
        const fingerprintQuery = {
          from: vi.fn(() => fingerprintQuery),
          where: vi.fn(async () => mocks.fingerprintRows),
        };
        return fingerprintQuery;
      }
      if (
        "id" in selection &&
        !("sessionId" in selection) &&
        !("respondentUuid" in selection)
      ) {
        const staleRunQuery = {
          from: vi.fn(() => staleRunQuery),
          where: vi.fn(async () => mocks.staleRunRows),
        };
        return staleRunQuery;
      }

      const query = {
        from: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(async () => {
          await responseLoadBlocker;
          return mocks.responseRows;
        }),
        where: vi.fn(() => query),
      };
      return query;
    });

    const result = handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    await vi.advanceTimersByTimeAsync(60_000);
    releaseResponseLoad();
    await result;

    expect(mocks.dbUpdatedTables).toContainEqual(
      expect.objectContaining({
        lockedAt: "responseLinkAnalysisLock.lockedAt",
      }),
    );
  });

  it("aborts analysis when the form lock heartbeat no longer updates a row", async () => {
    vi.useFakeTimers();
    let releaseResponseLoad: () => void = () => undefined;
    const responseLoadBlocker = new Promise<void>((resolve) => {
      releaseResponseLoad = resolve;
    });
    mocks.dbSelect.mockImplementation((selection: Record<string, unknown>) => {
      if ("fingerprintType" in selection) {
        const fingerprintQuery = {
          from: vi.fn(() => fingerprintQuery),
          where: vi.fn(async () => mocks.fingerprintRows),
        };
        return fingerprintQuery;
      }
      if (
        "id" in selection &&
        !("sessionId" in selection) &&
        !("respondentUuid" in selection)
      ) {
        const staleRunQuery = {
          from: vi.fn(() => staleRunQuery),
          where: vi.fn(async () => mocks.staleRunRows),
        };
        return staleRunQuery;
      }

      const query = {
        from: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(async () => {
          await responseLoadBlocker;
          return mocks.responseRows;
        }),
        where: vi.fn(() => query),
      };
      return query;
    });
    mocks.dbUpdate.mockImplementation((table: unknown) => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          mocks.dbUpdatedTables.push(table);
          if (
            typeof table === "object" &&
            table !== null &&
            "lockedAt" in table
          ) {
            return { affectedRows: 0 };
          }
          return undefined;
        }),
      })),
    }));

    const result = handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    await vi.advanceTimersByTimeAsync(60_000);
    releaseResponseLoad();

    await expect(result).rejects.toThrow("Lost response link analysis lock");
  });

  it("waits and retries when another worker holds the form lock", async () => {
    vi.useFakeTimers();
    const duplicateError = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
    });
    let lockInsertAttemptCount = 0;
    mocks.dbInsert.mockImplementation((table: unknown) => ({
      values: vi.fn(async () => {
        if (
          typeof table === "object" &&
          table !== null &&
          "lockedAt" in table
        ) {
          lockInsertAttemptCount += 1;
          if (lockInsertAttemptCount === 1) {
            throw duplicateError;
          }
        }
        return undefined;
      }),
    }));

    const result = handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(result).resolves.toEqual(
      expect.objectContaining({ groupCount: 0, linkCount: 0 }),
    );
    expect(lockInsertAttemptCount).toBe(2);
  });
});
