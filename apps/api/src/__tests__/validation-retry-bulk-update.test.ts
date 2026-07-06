import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => {
  const formTable = {
    id: "form.id",
    plateContent: "form.plateContent",
  };
  const formResponseTable = {
    id: "formResponse.id",
    formId: "formResponse.formId",
  };
  const formValidationRuleTable = {
    id: "formValidationRule.id",
    formId: "formValidationRule.formId",
    providerName: "formValidationRule.providerName",
    ruleType: "formValidationRule.ruleType",
    configJson: "formValidationRule.configJson",
    orderIndex: "formValidationRule.orderIndex",
  };
  const formValidationRuleBlockTable = {
    ruleId: "formValidationRuleBlock.ruleId",
    referencedBlockId: "formValidationRuleBlock.referencedBlockId",
    orderIndex: "formValidationRuleBlock.orderIndex",
  };
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const formLimit = vi.fn();
  const responseWhere = vi.fn();
  const ruleOrderBy = vi.fn();
  const ruleWhere = vi.fn(() => ({ orderBy: ruleOrderBy }));
  const ruleInnerJoin = vi.fn(() => ({ where: ruleWhere }));
  const from = vi.fn((table: unknown) => {
    if (table === formTable) {
      return { where: vi.fn(() => ({ limit: formLimit })) };
    }
    if (table === formResponseTable) {
      return { where: responseWhere };
    }
    if (table === formValidationRuleTable) {
      return { innerJoin: ruleInnerJoin };
    }
    return { where };
  });
  const select = vi.fn(() => ({ from }));
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onDuplicateKeyUpdate }));
  const insert = vi.fn(() => ({ values }));
  const txForUpdate = vi.fn();
  const txSelectWhere = vi.fn(() => ({ for: txForUpdate }));
  const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
  const txSelect = vi.fn(() => ({ from: txSelectFrom }));
  const txInsertValues = vi.fn().mockResolvedValue(undefined);
  const txInsert = vi.fn(() => ({ values: txInsertValues }));
  const txUpdateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
  const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }));
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
  const transaction = vi.fn(
    async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
      callback({
        insert: txInsert,
        select: txSelect,
        update: txUpdate,
      }),
  );
  const queueAdd = vi.fn();
  const inArray = vi.fn();
  const isNull = vi.fn();
  const notInArray = vi.fn();
  const getSnapshotByVersion = vi.fn();
  const parseValidationRuleSnapshot = vi.fn();
  const sqlMock = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      strings: Array.from(strings),
      values,
    }),
  ) as unknown as ((
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => unknown) & { join: ReturnType<typeof vi.fn> };
  sqlMock.join = vi.fn((chunks: unknown[], separator: unknown) => ({
    chunks,
    kind: "sql-join",
    separator,
  }));

  return {
    formResponseTable,
    formTable,
    formValidationRuleBlockTable,
    formValidationRuleTable,
    getSnapshotByVersion,
    formLimit,
    from,
    inArray,
    insert,
    isNull,
    notInArray,
    onDuplicateKeyUpdate,
    parseValidationRuleSnapshot,
    queueAdd,
    responseWhere,
    ruleOrderBy,
    ruleWhere,
    select,
    set,
    sqlMock,
    transaction,
    txForUpdate,
    txInsert,
    txInsertValues,
    txSelect,
    txUpdate,
    txUpdateSet,
    txUpdateWhere,
    update,
    values,
    where,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: mocks.insert,
    select: mocks.select,
    transaction: mocks.transaction,
    update: mocks.update,
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {
    id: "externalServiceValidationResult.id",
    status: "externalServiceValidationResult.status",
    lastAttemptAt: "externalServiceValidationResult.lastAttemptAt",
    nextRetryAt: "externalServiceValidationResult.nextRetryAt",
    errorCode: "externalServiceValidationResult.errorCode",
    errorMessage: "externalServiceValidationResult.errorMessage",
    jobId: "externalServiceValidationResult.jobId",
    snapshotVersion: "externalServiceValidationResult.snapshotVersion",
  },
  fingerprintDetail: {},
  form: mocks.formTable,
  formResponse: mocks.formResponseTable,
  formValidationRule: mocks.formValidationRuleTable,
  formValidationRuleBlock: mocks.formValidationRuleBlockTable,
}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    get: vi.fn(() => ({ rules: { member: {} } })),
    has: vi.fn(() => true),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: mocks.inArray,
  isNull: mocks.isNull,
  ne: vi.fn(),
  notInArray: mocks.notInArray,
  or: vi.fn(),
  sql: mocks.sqlMock,
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshotByVersion: vi.fn(),
  getSnapshotByVersion: mocks.getSnapshotByVersion,
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: mocks.parseValidationRuleSnapshot,
}));

vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContent: vi.fn(() => []),
}));

vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(() => ({ success: true })),
}));

vi.mock("../lib/forms/validation-results", () => ({
  getExternalValidationResults: vi.fn(() => []),
}));

vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../lib/queues", () => ({
  getValidationQueue: vi.fn(() => ({ add: mocks.queueAdd })),
  isValidServiceName: vi.fn(() => true),
}));

vi.mock("../lib/rate-limit", () => {
  const passThrough = async (
    _c: unknown,
    next: () => Promise<void>,
  ): Promise<void> => next();
  return {
    createRateLimit: vi.fn(() => passThrough),
    authRouteRateLimiter: passThrough,
    generalRateLimiter: passThrough,
    invitationSignInRateLimiter: passThrough,
  };
});

vi.mock("../lib/request-body-size-limit", () => ({
  createRequestBodySizeLimit: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../lib/response-data-json", () => ({
  stringifyResponseDataJson: vi.fn(() => "[]"),
}));

function retryTarget(id: string) {
  return {
    id,
    responseId: `response-${id}`,
    ruleId: `rule-${id}`,
    referencedBlockId: `block-${id}`,
    service: "discord",
    status: "FAILED" as const,
    formId: "form-1",
    snapshotVersion: 3,
    liveRuleType: "member",
    liveConfigJson: { guildId: "guild-1" },
  };
}

describe("R6-M9: validation retry bulk updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.where.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.formLimit.mockResolvedValue([
      {
        plateContent: JSON.stringify([
          {
            type: "form_short_text",
            blockId: "block-1",
            children: [{ text: "Discord handle" }],
          },
        ]),
      },
    ]);
    mocks.responseWhere.mockResolvedValue([{ id: "response-1" }]);
    mocks.ruleOrderBy.mockResolvedValue([
      {
        ruleId: "rule-current",
        providerName: "discord",
        ruleType: "member",
        configJson: { guildId: "current-guild" },
        referencedBlockId: "block-1",
        orderIndex: 0,
        blockOrderIndex: 0,
      },
    ]);
    mocks.values.mockReturnValue({
      onDuplicateKeyUpdate: mocks.onDuplicateKeyUpdate,
    });
    mocks.onDuplicateKeyUpdate.mockResolvedValue(undefined);
    mocks.txForUpdate.mockResolvedValue([]);
    mocks.txInsertValues.mockResolvedValue(undefined);
    mocks.txUpdateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.queueAdd.mockImplementation(
      async (
        _name: string,
        _data: unknown,
        options: { jobId?: string } | undefined,
      ) => ({
        id: options?.jobId,
      }),
    );
    mocks.getSnapshotByVersion.mockResolvedValue({
      id: "snapshot-1",
      formId: "form-1",
      version: 3,
      isActive: true,
      publishedBy: "owner-1",
      publishedAt: new Date("2026-05-24T00:00:00.000Z"),
      changeLog: null,
      title: "Published form",
      description: null,
      parentVersion: null,
      plateContent: "[]",
      validationRulesJson: "snapshot-rules",
      structureJson: JSON.stringify({
        version: 1,
        settings: { allow_edit_responses: false },
      }),
    });
    mocks.parseValidationRuleSnapshot.mockReturnValue([
      {
        id: "rule-result-1",
        name: "Published result 1",
        providerName: "discord",
        ruleType: "member",
        referencedBlockIds: ["block-result-1"],
        configJson: { guildId: "guild-1" },
        orderIndex: 0,
      },
      {
        id: "rule-result-2",
        name: "Published result 2",
        providerName: "discord",
        ruleType: "member",
        referencedBlockIds: ["block-result-2"],
        configJson: { guildId: "guild-1" },
        orderIndex: 1,
      },
    ]);
  });

  it("claims retry rows before enqueueing validation jobs", async () => {
    const { enqueueValidationRetries } = await import(
      "../routes/forms-responses"
    );
    const minimumLeaseExpiry = Date.now() + 4 * 60 * 1000;

    const result = await enqueueValidationRetries([
      retryTarget("result-1"),
      retryTarget("result-2"),
    ]);

    expect(result).toMatchObject({
      enqueuedCount: 2,
      skippedCount: 0,
      jobIds: [
        expect.stringMatching(/^validation-retry-result-1-/),
        expect.stringMatching(/^validation-retry-result-2-/),
      ],
    });
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.where).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueAdd.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.update.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.queueAdd.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      1,
      "validate-discord",
      expect.objectContaining({
        responseId: "response-result-1",
        snapshotVersion: 3,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-retry-result-1-/),
      }),
    );
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      2,
      "validate-discord",
      expect.objectContaining({ responseId: "response-result-2" }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^validation-retry-result-2-/),
      }),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING",
        errorCode: null,
        errorMessage: null,
        jobId: expect.stringMatching(/^validation-retry-result-1-/),
      }),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING",
        errorCode: null,
        errorMessage: null,
        jobId: expect.stringMatching(/^validation-retry-result-2-/),
      }),
    );
    const setCalls = mocks.set.mock.calls as unknown as Array<
      [Record<string, unknown> & { nextRetryAt: Date }]
    >;
    for (const [update] of setCalls) {
      expect(update).toEqual(
        expect.objectContaining({ nextRetryAt: expect.any(Date) }),
      );
      expect(update.nextRetryAt.getTime()).toBeGreaterThanOrEqual(
        minimumLeaseExpiry,
      );
    }
  });

  it("does not enqueue when another retry already claimed the result", async () => {
    mocks.where.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const { enqueueValidationRetries } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRetries([retryTarget("result-1")]);

    expect(result).toEqual({
      enqueuedCount: 0,
      skippedCount: 1,
      jobIds: [],
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("uses published snapshot rule config instead of live rule config for snapshot retries", async () => {
    const { getSnapshotByVersion } = await import(
      "../lib/forms/snapshot-repository"
    );
    const { parseValidationRuleSnapshot } = await import(
      "../lib/forms/validation-rule-repository"
    );
    vi.mocked(getSnapshotByVersion).mockResolvedValue({
      id: "snapshot-1",
      formId: "form-1",
      version: 3,
      isActive: true,
      publishedBy: "owner-1",
      publishedAt: new Date("2026-05-24T00:00:00.000Z"),
      changeLog: null,
      title: "Published form",
      description: null,
      parentVersion: null,
      plateContent: "[]",
      validationRulesJson: "snapshot-rules",
      structureJson: JSON.stringify({
        version: 1,
        settings: { allow_edit_responses: false },
      }),
    });
    vi.mocked(parseValidationRuleSnapshot).mockReturnValue([
      {
        id: "rule-result-1",
        name: "Published Discord membership",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["block-result-1"],
        configJson: { guildId: "published-guild" },
        orderIndex: 0,
      },
    ]);
    const { enqueueValidationRetries } = await import(
      "../routes/forms-responses"
    );

    await enqueueValidationRetries([
      {
        ...retryTarget("result-1"),
        liveRuleType: "changed_live_rule",
        liveConfigJson: { guildId: "draft-guild" },
      },
    ]);

    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        ruleId: "rule-result-1",
        snapshotRuleType: "guild_member",
        snapshotConfigJson: { guildId: "published-guild" },
        snapshotVersion: 3,
      }),
      expect.any(Object),
    );
  });
});

describe("REVAL-1: historical response revalidation enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([
      {
        plateContent: JSON.stringify([
          {
            type: "form_short_text",
            blockId: "block-1",
            children: [{ text: "Discord handle" }],
          },
        ]),
      },
    ]);
    mocks.responseWhere.mockResolvedValue([{ id: "response-1" }]);
    mocks.ruleOrderBy.mockResolvedValue([
      {
        ruleId: "rule-current",
        providerName: "discord",
        ruleType: "member",
        configJson: { guildId: "current-guild" },
        referencedBlockId: "block-1",
        orderIndex: 0,
        blockOrderIndex: 0,
      },
    ]);
    mocks.values.mockReturnValue({
      onDuplicateKeyUpdate: mocks.onDuplicateKeyUpdate,
    });
    mocks.onDuplicateKeyUpdate.mockResolvedValue(undefined);
    mocks.txForUpdate.mockResolvedValue([]);
    mocks.txInsertValues.mockResolvedValue(undefined);
    mocks.txUpdateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.queueAdd.mockImplementation(
      async (
        _name: string,
        _data: unknown,
        options: { jobId?: string } | undefined,
      ) => ({
        id: options?.jobId,
      }),
    );
  });

  it("enqueues current validation config without a submitted snapshot version", async () => {
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 1,
      skippedCount: 0,
      jobIds: [
        expect.stringMatching(/^validation-revalidation-validation-result-/),
      ],
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "enqueued",
        }),
      ],
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "validate-discord",
      expect.not.objectContaining({ snapshotVersion: expect.anything() }),
      expect.objectContaining({
        jobId: expect.stringMatching(
          /^validation-revalidation-validation-result-/,
        ),
      }),
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "validate-discord",
      expect.objectContaining({
        responseId: "response-1",
        ruleId: "rule-current",
        referencedBlockId: "block-1",
        snapshotProviderName: "discord",
        snapshotRuleType: "member",
        snapshotConfigJson: { guildId: "current-guild" },
      }),
      expect.any(Object),
    );
    expect(mocks.txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "response-1",
        ruleId: "rule-current",
        referencedBlockId: "block-1",
        snapshotVersion: null,
        service: "discord",
        status: "PENDING",
        success: null,
        jobId: expect.stringMatching(
          /^validation-revalidation-validation-result-/,
        ),
      }),
    );
  });

  it("skips deleted, missing, or unauthorized response ids before enqueue", async () => {
    mocks.responseWhere.mockResolvedValue([{ id: "response-1" }]);
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1", "deleted-response"],
    });

    expect(result.enqueuedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responseId: "deleted-response",
          status: "skipped",
          reason: "response_not_found",
        }),
      ]),
    );
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
  });

  it("skips current rules whose referenced block no longer exists", async () => {
    mocks.formLimit.mockResolvedValue([
      {
        plateContent: JSON.stringify([
          {
            type: "form_short_text",
            blockId: "block-current",
            children: [{ text: "Current field" }],
          },
        ]),
      },
    ]);
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 0,
      skippedCount: 1,
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "skipped",
          reason: "referenced_block_missing",
        }),
      ],
    });
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("skips overlapping revalidation while a pending claim lease is active", async () => {
    mocks.txForUpdate.mockResolvedValue([
      {
        status: "PENDING",
        nextRetryAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      },
    ]);
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 0,
      skippedCount: 1,
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "skipped",
        }),
      ],
    });
    expect(mocks.txUpdate).not.toHaveBeenCalled();
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("skips pending initial validation rows without a retry lease", async () => {
    mocks.txForUpdate.mockResolvedValue([
      {
        status: "PENDING",
        nextRetryAt: null,
        updatedAt: new Date(),
      },
    ]);
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 0,
      skippedCount: 1,
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "skipped",
        }),
      ],
    });
    expect(mocks.txUpdate).not.toHaveBeenCalled();
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("skips overlapping revalidation while a processing claim is active", async () => {
    mocks.txForUpdate.mockResolvedValue([
      {
        status: "PROCESSING",
        nextRetryAt: null,
        updatedAt: new Date(),
      },
    ]);
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 0,
      skippedCount: 1,
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "skipped",
        }),
      ],
    });
    expect(mocks.txUpdate).not.toHaveBeenCalled();
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("skips when a concurrent revalidation creates the missing result row first", async () => {
    mocks.txInsertValues.mockRejectedValueOnce(
      Object.assign(new Error("Duplicate entry"), {
        code: "ER_DUP_ENTRY",
        errno: 1062,
      }),
    );
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 0,
      skippedCount: 1,
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "skipped",
        }),
      ],
    });
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("marks only the claimed revalidation row failed when enqueue fails", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("queue unavailable"));
    const { enqueueValidationRevalidations } = await import(
      "../routes/forms-responses"
    );

    const result = await enqueueValidationRevalidations({
      formId: "form-1",
      responseIds: ["response-1"],
    });

    expect(result).toMatchObject({
      enqueuedCount: 0,
      skippedCount: 1,
      results: [
        expect.objectContaining({
          responseId: "response-1",
          status: "skipped",
          reason: "enqueue_failed",
        }),
      ],
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({
      status: "FAILED",
      errorCode: "ENQUEUE_FAILED",
      errorMessage: "Failed to enqueue revalidation job",
    });
    expect(mocks.where).toHaveBeenCalledTimes(1);
  });
});
