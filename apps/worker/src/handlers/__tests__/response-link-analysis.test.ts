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
  queueClose: vi.fn(async () => undefined),
  queueAdd: vi.fn(async () => undefined),
  queueGetJob: vi.fn(async () => null),
  redisDel: vi.fn(async () => 0),
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
} from "../response-link-analysis";

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
  mocks.txUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  });
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
  mocks.queueAdd.mockClear();
  mocks.queueClose.mockClear();
  mocks.queueGetJob.mockClear();
  mocks.queueOptions = [];
  mocks.redisQuit.mockClear();
  mocks.redisDel.mockReset();
  mocks.redisDel.mockResolvedValue(0);
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

  it("fails the run instead of persisting incomplete results when the candidate cap is exceeded", async () => {
    mocks.responseRows = Array.from({ length: 6 }, (_, index) => ({
      id: `response-${index.toString().padStart(3, "0")}`,
      sessionId: "same-session",
      respondentUuid: `respondent-${index}`,
      userAgent: null,
    }));

    await expect(
      analyzeResponseLinks("form-1", {
        maxCandidatePairs: 10,
      }),
    ).rejects.toThrow("exceeded candidate pair limit");

    const pairInsert = mocks.txInsertedRows.find(
      (entry) => entry.table === "responsePairLink",
    );
    expect(pairInsert).toBeUndefined();
    expect(mocks.dbTransaction).not.toHaveBeenCalled();
    const updateSet = mocks.dbUpdate.mock.results[0]?.value?.set;
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
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
    mocks.redisDel.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const result = await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);

    expect(result.linkCount).toBe(0);
    expect(mocks.redisDel).toHaveBeenCalledTimes(2);
    expect(mocks.redisDel).toHaveBeenCalledWith(
      "response-link-analysis:dirty:form-1",
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
    mocks.redisDel.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

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
    mocks.redisDel.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await handleResponseLinkAnalysis({
      data: { formId: "form-1", reason: "manual" },
      id: "job-1",
    } as Job<ResponseLinkAnalysisJobData>);
    await closeResponseLinkAnalysisResources();

    expect(mocks.queueClose).toHaveBeenCalledTimes(1);
    expect(mocks.redisQuit).toHaveBeenCalledTimes(1);
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
