import {
  providerRegistry,
  type ValidationProvider,
  type ValidationProviderRule,
} from "@nexus-form/integrations";
import { DelayedError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleGenericValidation } from "../generic-validation";

const shutdownSignalMock = vi.hoisted(() => {
  let controller = new AbortController();
  const signal = {
    get aborted(): boolean {
      return controller.signal.aborted;
    },
    get onabort(): AbortSignal["onabort"] {
      return controller.signal.onabort;
    },
    set onabort(value: AbortSignal["onabort"]) {
      controller.signal.onabort = value;
    },
    get reason(): unknown {
      return controller.signal.reason;
    },
    addEventListener(
      ...args: Parameters<AbortSignal["addEventListener"]>
    ): void {
      controller.signal.addEventListener(...args);
    },
    dispatchEvent(...args: Parameters<AbortSignal["dispatchEvent"]>): boolean {
      return controller.signal.dispatchEvent(...args);
    },
    removeEventListener(
      ...args: Parameters<AbortSignal["removeEventListener"]>
    ): void {
      controller.signal.removeEventListener(...args);
    },
    throwIfAborted(): void {
      controller.signal.throwIfAborted();
    },
  };

  return {
    signal,
    abort(reason?: unknown): void {
      controller.abort(
        reason ?? new DOMException("Worker shutdown", "AbortError"),
      );
    },
    reset(): void {
      controller = new AbortController();
    },
  };
});

vi.mock("@nexus-form/integrations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@nexus-form/integrations")>();
  return {
    ...actual,
    providerRegistry: {
      get: vi.fn(),
    },
  };
});

vi.mock("../../lib/shutdown-signal", () => {
  return {
    workerShutdownSignal: shutdownSignalMock.signal,
    abortWorkerShutdown: vi.fn((reason?: unknown) => {
      shutdownSignalMock.abort(reason);
    }),
  };
});

vi.mock("../../lib/validation-helpers", () => {
  class ConcurrentDeleteError extends Error {
    constructor(
      public readonly responseId: string,
      public readonly ruleId: string,
      public readonly referencedBlockId: string,
    ) {
      super(
        `markValidationProcessing: row deleted concurrently for responseId=${responseId} ruleId=${ruleId} referencedBlockId=${referencedBlockId}`,
      );
      this.name = "ConcurrentDeleteError";
    }
  }

  class ValidationCancelledError extends Error {
    constructor(
      public readonly responseId: string,
      public readonly ruleId: string,
      public readonly referencedBlockId: string,
    ) {
      super(
        `Validation cancelled concurrently for responseId=${responseId} ruleId=${ruleId} referencedBlockId=${referencedBlockId}`,
      );
      this.name = "ValidationCancelledError";
    }
  }

  class StaleValidationJobError extends Error {
    constructor(
      public readonly responseId: string,
      public readonly ruleId: string,
      public readonly referencedBlockId: string,
      public readonly expectedJobId: string,
      public readonly actualJobId: string | null,
    ) {
      super(
        `Stale validation job ignored for responseId=${responseId} ruleId=${ruleId} referencedBlockId=${referencedBlockId} expectedJobId=${expectedJobId} actualJobId=${actualJobId ?? "null"}`,
      );
      this.name = "StaleValidationJobError";
    }
  }

  class ReferencedBlockMissingError extends Error {
    constructor(
      public readonly formId: string,
      public readonly responseId: string,
      public readonly ruleId: string,
      public readonly referencedBlockId: string,
    ) {
      super("Referenced block missing");
      this.name = "ReferencedBlockMissingError";
    }
  }
  return {
    getValidationContext: vi.fn(),
    markValidationProcessing: vi.fn(),
    writeValidationResult: vi.fn(),
    ConcurrentDeleteError,
    StaleValidationJobError,
    ValidationCancelledError,
    ReferencedBlockMissingError,
  };
});

vi.mock("../../lib/redis-lock", () => {
  interface RedisLockOptions {
    ttlMs?: number;
    waitTimeoutMs?: number;
    retryDelayMs?: number;
  }

  class RedisLockAcquireTimeoutError extends Error {
    constructor(
      public readonly key: string,
      public readonly waitTimeoutMs: number,
    ) {
      super(`Failed to acquire redis lock "${key}" within ${waitTimeoutMs}ms`);
      this.name = "RedisLockAcquireTimeoutError";
    }
  }

  return {
    RedisLockAcquireTimeoutError,
    withRedisLock: vi.fn(
      <T>(
        _key: string,
        fn: () => Promise<T>,
        _options?: RedisLockOptions,
      ): Promise<T> => fn(),
    ),
  };
});

import {
  RedisLockAcquireTimeoutError,
  withRedisLock,
} from "../../lib/redis-lock";
import {
  ConcurrentDeleteError,
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  StaleValidationJobError,
  ValidationCancelledError,
  writeValidationResult,
} from "../../lib/validation-helpers";

const mockGetValidationContext = vi.mocked(getValidationContext);
const mockMarkValidationProcessing = vi.mocked(markValidationProcessing);
const mockWriteValidationResult = vi.mocked(writeValidationResult);
const mockProviderRegistryGet = vi.mocked(providerRegistry.get);
const mockWithRedisLock = vi.mocked(withRedisLock);

function makeJob(data: {
  jobId?: string;
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  snapshotProviderName?: string;
  snapshotRuleType?: string;
  snapshotConfigJson?: Record<string, unknown>;
  snapshotVersion?: number;
  retryAfterCount?: number;
  attemptsMade?: number;
}): Job {
  const { attemptsMade, jobId, ...jobData } = data;
  return {
    id: jobId ?? "job-1",
    data: {
      snapshotProviderName: "test-provider",
      snapshotRuleType: "default",
      snapshotConfigJson: { raw: "value" },
      ...jobData,
    },
    opts: { attempts: 3 },
    attemptsMade: attemptsMade ?? 0,
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
    updateData: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

function makeRule(
  overrides: Partial<ValidationProviderRule> = {},
): ValidationProviderRule {
  return {
    name: "default",
    label: "Default Rule",
    description: "Default rule",
    inputHint: "Enter value",
    inputSchema: {
      parse: vi.fn().mockReturnValue("test-input"),
    } as unknown as ValidationProviderRule["inputSchema"],
    configSchema: {
      parse: vi.fn().mockReturnValue({}),
    } as unknown as ValidationProviderRule["configSchema"],
    metadataSchema: {
      safeParse: vi.fn().mockReturnValue({ success: true, data: {} }),
    } as unknown as ValidationProviderRule["metadataSchema"],
    validate: vi.fn().mockResolvedValue({ isValid: true }),
    ...overrides,
  };
}

function makeProvider(
  rule: ValidationProviderRule = makeRule(),
  name = "test-provider",
): ValidationProvider {
  return {
    name,
    label: "Test",
    description: "Test provider",
    rules: { [rule.name]: rule },
  };
}

const baseContext = {
  response: {
    id: "r-1",
    formId: "form-1",
  },
  referencedValue: "test-input",
} as unknown as Awaited<ReturnType<typeof getValidationContext>>;

beforeEach(() => {
  shutdownSignalMock.reset();
  vi.clearAllMocks();
  mockGetValidationContext.mockResolvedValue(baseContext);
  mockMarkValidationProcessing.mockResolvedValue(undefined);
  mockWriteValidationResult.mockResolvedValue("mock-result-id");
});

describe("handleGenericValidation", () => {
  it("job.data が不正な形状の場合は処理境界で弾く", async () => {
    await expect(
      handleGenericValidation(
        makeJob({
          responseId: "r-1",
          ruleId: "",
          referencedBlockId: "block-a",
        }),
      ),
    ).rejects.toThrow();

    expect(mockGetValidationContext).not.toHaveBeenCalled();
    expect(mockMarkValidationProcessing).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("snapshotVersion がある場合は送信時 snapshot を指定して context を取得する", async () => {
    mockProviderRegistryGet.mockReturnValue(makeProvider());
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotVersion: 3,
    });

    await handleGenericValidation(job);

    expect(mockGetValidationContext).toHaveBeenCalledWith(
      "r-1",
      "rule-1",
      "block-a",
      3,
    );
  });

  it("getValidationContextがReferencedBlockMissingErrorをスローした場合にMISSINGを書き込んでok:falseを返す", async () => {
    mockGetValidationContext.mockRejectedValue(
      new ReferencedBlockMissingError("form-1", "r-1", "rule-1", "block-a"),
    );
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Referenced block missing" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        status: "MISSING",
        errorCode: "REFERENCED_BLOCK_MISSING",
      }),
    );
    expect(mockMarkValidationProcessing).not.toHaveBeenCalled();
  });

  it("markValidationProcessingがConcurrentDeleteErrorをスローした場合は結果を書かずに終端化する", async () => {
    mockMarkValidationProcessing.mockRejectedValue(
      new ConcurrentDeleteError("r-1", "rule-1", "block-a"),
    );
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Result row deleted" });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
    expect(mockProviderRegistryGet).not.toHaveBeenCalled();
  });

  it("markValidationProcessingがValidationCancelledErrorをスローした場合は結果を書かずに終端化する", async () => {
    mockMarkValidationProcessing.mockRejectedValue(
      new ValidationCancelledError("r-1", "rule-1", "block-a"),
    );
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Validation cancelled" });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
    expect(mockProviderRegistryGet).not.toHaveBeenCalled();
  });

  it("markValidationProcessingがStaleValidationJobErrorをスローした場合は結果を書かずに終端化する", async () => {
    mockMarkValidationProcessing.mockRejectedValue(
      new StaleValidationJobError("r-1", "rule-1", "block-a", "job-a", "job-b"),
    );
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Stale validation job" });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
    expect(mockProviderRegistryGet).not.toHaveBeenCalled();
  });

  it("AbortError（最終試行時）はPROCESSING状態をFAILEDへ更新し、ok:falseで終了する", async () => {
    const rule = makeRule({
      validate: vi
        .fn()
        .mockRejectedValue(new DOMException("Shutdown", "AbortError")),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Validation interrupted during shutdown",
    });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        success: false,
        errorCode: "VALIDATION_ABORTED_DURING_SHUTDOWN",
      }),
    );
  });

  it("AbortError（最終試行以外）は再キューされるよう再スローする", async () => {
    const rule = makeRule({
      validate: vi
        .fn()
        .mockRejectedValue(new DOMException("Shutdown", "AbortError")),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("provider AbortError と worker shutdown が重なっても非最終試行では再スローする", async () => {
    const rule = makeRule({
      validate: vi.fn().mockImplementation(async () => {
        shutdownSignalMock.abort(
          new DOMException("Worker shutdown", "AbortError"),
        );
        throw new DOMException("Provider timeout", "AbortError");
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toMatchObject({
      message: "Provider timeout",
      name: "AbortError",
    });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("shutdown AbortError は最終試行以外では再キューされるよう再スローする", async () => {
    const rule = makeRule({
      validate: vi.fn().mockImplementation(async () => {
        const shutdownReason = new DOMException(
          "Worker shutdown",
          "AbortError",
        );
        shutdownSignalMock.abort(shutdownReason);
        throw shutdownReason;
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockMarkValidationProcessing).toHaveBeenCalled();
    expect(rule.validate).toHaveBeenCalledWith("test-input", {});
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("PROCESSING 更新直後の shutdown AbortError は provider 実行前でも再スローする", async () => {
    const rule = makeRule();
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    mockMarkValidationProcessing.mockImplementationOnce(async () => {
      shutdownSignalMock.abort(
        new DOMException("Worker shutdown", "AbortError"),
      );
    });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(rule.validate).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("PROCESSING 更新直後に非 AbortError reason で shutdown しても PROCESSING に残さない", async () => {
    const rule = makeRule();
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    mockMarkValidationProcessing.mockImplementationOnce(async () => {
      shutdownSignalMock.abort(new Error("Worker shutdown"));
    });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 1,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Worker shutdown" });
    expect(rule.validate).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "test-provider",
        success: false,
        errorCode: "VALIDATION_ERROR",
        errorMessage: "Worker shutdown",
      }),
    );
  });

  it("markValidationProcessingがConcurrentDeleteError以外をスローした場合は再スローする", async () => {
    mockMarkValidationProcessing.mockRejectedValue(new Error("db unavailable"));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "db unavailable",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
    expect(mockProviderRegistryGet).not.toHaveBeenCalled();
  });

  it("プロバイダーが見つからない場合にエラーを返す", async () => {
    mockProviderRegistryGet.mockReturnValue(undefined);
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Provider rule not found" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROVIDER_NOT_FOUND" }),
    );
  });

  it("ruleType が provider に未登録の場合にエラーを返す", async () => {
    const rule = makeRule({ name: "other" });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue(provider);
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Provider rule not found" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "UNKNOWN_RULE_TYPE" }),
    );
  });

  it("設定スキーマのバリデーション失敗時にエラーを返す", async () => {
    const rule = makeRule();
    (rule.configSchema.parse as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error("Config invalid");
      },
    );
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Config validation failed" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "CONFIG_VALIDATION_ERROR" }),
    );
  });

  it("入力スキーマのバリデーション失敗時にエラーを返す", async () => {
    const rule = makeRule();
    (rule.inputSchema.parse as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error("Input invalid");
      },
    );
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Input validation failed" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "INPUT_VALIDATION_ERROR" }),
    );
  });

  it("バリデーション成功時にok:trueを返す", async () => {
    const rule = makeRule();
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: true, provider: "test-provider" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  const setupMockExternalProvider = () => {
    const validationConfig = { mode: "fixture" };
    const validateFn = vi.fn();
    const rule = makeRule({
      name: "mock_rule",
      configSchema: z.object({ mode: z.literal("fixture") }),
      metadataSchema: z.record(z.string(), z.unknown()),
      validate: validateFn,
    });
    mockProviderRegistryGet.mockReturnValue(
      makeProvider(rule, "mock_external"),
    );
    const baseJobData = {
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "mock_external",
      snapshotRuleType: "mock_rule",
      snapshotConfigJson: validationConfig,
    };

    return { baseJobData, validateFn, validationConfig };
  };

  it("credentialなしmock providerでworker handlerの成功状態を再現できる", async () => {
    const { baseJobData, validateFn, validationConfig } =
      setupMockExternalProvider();

    validateFn.mockResolvedValueOnce({
      isValid: true,
      metadata: { fixtureCase: "success" },
    });
    const successResult = await handleGenericValidation(makeJob(baseJobData));

    expect(successResult).toEqual({ ok: true, provider: "mock_external" });
    expect(mockProviderRegistryGet).toHaveBeenCalledWith("mock_external");
    expect(validateFn).toHaveBeenLastCalledWith("test-input", validationConfig);
    expect(mockMarkValidationProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "mock_external",
      }),
    );
    expect(mockWriteValidationResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        service: "mock_external",
        success: true,
        metadata: { fixtureCase: "success" },
      }),
    );
  });

  it("credentialなしmock providerでworker handlerの失敗状態を再現できる", async () => {
    const { baseJobData, validateFn } = setupMockExternalProvider();

    validateFn.mockResolvedValueOnce({
      isValid: false,
      errorCode: "MOCK_PERMISSION_DENIED",
      errorMessage: "Mock provider permission denied",
      retryable: false,
    });
    const failureResult = await handleGenericValidation(makeJob(baseJobData));

    expect(failureResult).toEqual({
      ok: false,
      provider: "mock_external",
    });
    expect(mockWriteValidationResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        service: "mock_external",
        success: false,
        errorCode: "MOCK_PERMISSION_DENIED",
        errorMessage: "Mock provider permission denied",
      }),
    );
  });

  it("credentialなしmock providerでworker handlerの保留状態を再現できる", async () => {
    const { baseJobData, validateFn } = setupMockExternalProvider();

    validateFn.mockResolvedValueOnce({
      isValid: false,
      errorCode: "MOCK_RATE_LIMIT",
      errorMessage: "Mock provider is temporarily rate limited",
      retryAfter: 45,
      retryable: true,
    });
    const pendingJob = makeJob(baseJobData);

    await expect(
      handleGenericValidation(pendingJob, "lock-token"),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(mockMarkValidationProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "mock_external",
        jobId: "job-1",
      }),
    );
    expect(pendingJob.updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        retryAfterCount: 1,
      }),
    );
    expect(pendingJob.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      "lock-token",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("credentialなしmock providerでworker handlerの再検証状態を再現できる", async () => {
    const { baseJobData, validateFn } = setupMockExternalProvider();

    validateFn.mockResolvedValueOnce({
      isValid: true,
      metadata: { fixtureCase: "revalidation" },
    });
    const retryJobId = "validation-retry-result-fixture-rerun";
    const retryResult = await handleGenericValidation(
      makeJob({
        ...baseJobData,
        jobId: retryJobId,
      }),
    );

    expect(retryResult).toEqual({ ok: true, provider: "mock_external" });
    expect(mockMarkValidationProcessing).toHaveBeenLastCalledWith(
      expect.objectContaining({
        service: "mock_external",
        jobId: retryJobId,
      }),
    );
    expect(mockWriteValidationResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        service: "mock_external",
        success: true,
        metadata: { fixtureCase: "revalidation" },
        jobId: retryJobId,
      }),
    );
  });

  it("revalidation job ignores a response deleted after enqueue", async () => {
    mockGetValidationContext.mockRejectedValueOnce(
      new Error("Form response not found: response-1"),
    );
    const { baseJobData } = setupMockExternalProvider();

    const result = await handleGenericValidation(
      makeJob({
        ...baseJobData,
        responseId: "response-1",
        jobId: "validation-revalidation-result-fixture-rerun",
      }),
    );

    expect(result).toEqual({ ok: false, error: "Response deleted" });
    expect(mockMarkValidationProcessing).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  type R26M3ResolvedSmokeCase = {
    formId: string;
    jobId: string;
    providerResult: unknown;
    expectedResult: { ok: boolean; provider: "mock_external" };
    expectedWrite: Record<string, unknown>;
  };

  const runR26M3ResolvedSmokeCase = async (
    smokeCase: R26M3ResolvedSmokeCase,
  ) => {
    mockGetValidationContext.mockResolvedValue({
      ...baseContext,
      response: {
        id: "r-1",
        formId: smokeCase.formId,
      },
    } as Awaited<ReturnType<typeof getValidationContext>>);
    const { baseJobData, validateFn } = setupMockExternalProvider();
    validateFn.mockResolvedValueOnce(smokeCase.providerResult);

    const result = await handleGenericValidation(
      makeJob({
        ...baseJobData,
        jobId: smokeCase.jobId,
      }),
    );

    expect(result).toEqual(smokeCase.expectedResult);
    expect(mockMarkValidationProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: smokeCase.formId,
        jobId: smokeCase.jobId,
        service: "mock_external",
      }),
    );
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ...smokeCase.expectedWrite,
        service: "mock_external",
      }),
    );
  };

  it("R26-M3 S04専用フォーム方式で外部検証の成功をmock smokeできる", async () => {
    await runR26M3ResolvedSmokeCase({
      formId: "codex-story-qa-s04-form",
      jobId: "r26-m3-s04-success",
      providerResult: {
        isValid: true,
        metadata: { story: "S04", fixtureCase: "success" },
      },
      expectedResult: { ok: true, provider: "mock_external" },
      expectedWrite: {
        formId: "codex-story-qa-s04-form",
        jobId: "r26-m3-s04-success",
        success: true,
        metadata: { story: "S04", fixtureCase: "success" },
      },
    });
  });

  it("R26-M3 S05専用フォーム方式で外部検証の失敗をmock smokeできる", async () => {
    await runR26M3ResolvedSmokeCase({
      formId: "codex-story-qa-s05-form",
      jobId: "r26-m3-s05-failure",
      providerResult: {
        isValid: false,
        errorCode: "MOCK_PERMISSION_DENIED",
        errorMessage: "Mock provider permission denied",
        retryable: false,
      },
      expectedResult: { ok: false, provider: "mock_external" },
      expectedWrite: {
        formId: "codex-story-qa-s05-form",
        jobId: "r26-m3-s05-failure",
        success: false,
        errorCode: "MOCK_PERMISSION_DENIED",
        errorMessage: "Mock provider permission denied",
      },
    });
  });

  it("R26-M3 S17専用フォーム方式で外部検証の再検証をmock smokeできる", async () => {
    await runR26M3ResolvedSmokeCase({
      formId: "codex-story-qa-s17-form",
      jobId: "validation-retry-r26-m3-s17-result-rerun",
      providerResult: {
        isValid: true,
        metadata: { story: "S17", fixtureCase: "revalidation" },
      },
      expectedResult: { ok: true, provider: "mock_external" },
      expectedWrite: {
        formId: "codex-story-qa-s17-form",
        jobId: "validation-retry-r26-m3-s17-result-rerun",
        success: true,
        metadata: { story: "S17", fixtureCase: "revalidation" },
      },
    });
  });

  it("R26-M3 S06専用フォーム方式で外部検証の保留をmock smokeできる", async () => {
    mockGetValidationContext.mockResolvedValue({
      ...baseContext,
      response: {
        id: "r-1",
        formId: "codex-story-qa-s06-form",
      },
    } as Awaited<ReturnType<typeof getValidationContext>>);
    const { baseJobData, validateFn } = setupMockExternalProvider();
    validateFn.mockResolvedValueOnce({
      isValid: false,
      errorCode: "MOCK_RATE_LIMIT",
      errorMessage: "Mock provider is temporarily rate limited",
      retryAfter: 45,
      retryable: true,
    });
    const pendingJob = makeJob({
      ...baseJobData,
      jobId: "r26-m3-s06-pending",
    });

    await expect(
      handleGenericValidation(pendingJob, "lock-token"),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(mockMarkValidationProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "codex-story-qa-s06-form",
        jobId: "r26-m3-s06-pending",
        service: "mock_external",
      }),
    );
    expect(pendingJob.updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        retryAfterCount: 1,
      }),
    );
    expect(pendingJob.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      "lock-token",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("Discord validation は Redis lock 内で実行して複数レプリカ間の同時実行を抑止する", async () => {
    const validateFn = vi.fn().mockResolvedValue({ isValid: true });
    const rule = makeRule({ validate: validateFn });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: true, provider: "discord" });
    expect(mockWithRedisLock).toHaveBeenCalledWith(
      "nexus-form:discord-validation-api",
      expect.any(Function),
      expect.objectContaining({
        ttlMs: 120_000,
        waitTimeoutMs: 125_000,
      }),
    );
    expect(validateFn).toHaveBeenCalledWith("test-input", {});
  });

  it("Discord validation の Redis lock 取得タイムアウトはリトライ可能エラーとして再スローする", async () => {
    mockWithRedisLock.mockRejectedValueOnce(
      new RedisLockAcquireTimeoutError(
        "nexus-form:discord-validation-api",
        125_000,
      ),
    );
    const rule = makeRule();
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
    });

    await expect(handleGenericValidation(job)).rejects.toMatchObject({
      code: "DISCORD_DISTRIBUTED_LOCK_TIMEOUT",
    });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("Discord validation の Redis lock 待機中 shutdown AbortError は最終試行前に再スローする", async () => {
    mockWithRedisLock.mockImplementationOnce(async () => {
      const shutdownReason = new DOMException("Worker shutdown", "AbortError");
      shutdownSignalMock.abort(shutdownReason);
      throw shutdownReason;
    });
    const rule = makeRule();
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("Discord validation の入力形式が不正な場合は validate を呼ばずに INPUT_VALIDATION_ERROR を書き込む", async () => {
    const validateFn = vi.fn().mockResolvedValue({ isValid: true });
    const rule = makeRule({
      inputSchema: {
        parse: vi.fn().mockImplementation(() => {
          throw new Error("Invalid Discord user id");
        }),
      } as unknown as ValidationProviderRule["inputSchema"],
      validate: validateFn,
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Input validation failed" });
    expect(validateFn).not.toHaveBeenCalled();
    expect(mockWithRedisLock).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "discord",
        success: false,
        errorCode: "INPUT_VALIDATION_ERROR",
        errorMessage: "Invalid input format",
      }),
    );
  });

  it("Discord retryable result without retryAfter は最終試行前に BullMQ retry へ委譲し結果を書かない", async () => {
    const safeDiscordApiFailureMessage =
      "Discord APIへの接続に失敗しました。しばらくしてから再試行してください";
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "DISCORD_API_ERROR",
        errorMessage: safeDiscordApiFailureMessage,
      }),
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      safeDiscordApiFailureMessage,
    );

    expect(mockWithRedisLock).toHaveBeenCalledWith(
      "nexus-form:discord-validation-api",
      expect.any(Function),
      expect.objectContaining({
        ttlMs: 120_000,
        waitTimeoutMs: 125_000,
      }),
    );
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("Discord retryable result without retryAfter は最終 BullMQ attempt で安全な失敗理由を書き込み遅延再試行しない", async () => {
    const safeDiscordApiFailureMessage =
      "Discord APIへの接続に失敗しました。しばらくしてから再試行してください";
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "DISCORD_API_ERROR",
        errorMessage: safeDiscordApiFailureMessage,
      }),
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "discord",
        success: false,
        errorCode: "DISCORD_API_ERROR",
        errorMessage: safeDiscordApiFailureMessage,
      }),
    );
  });

  it("GitHub validation 成功時は metadata を含む結果を DB/SSE 書き込み経路へ渡す", async () => {
    const githubMetadata = {
      username: "octocat",
      userId: 1,
      displayName: "Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      profileUrl: "https://github.com/octocat",
      bio: "A cat",
      publicRepos: 8,
      followers: 5000,
      following: 9,
      createdAt: "2011-01-25T18:44:36Z",
      updatedAt: "2023-01-01T00:00:00Z",
    };
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: true,
        metadata: githubMetadata,
      }),
      metadataSchema: {
        safeParse: vi.fn().mockReturnValue({
          success: true,
          data: githubMetadata,
        }),
      } as unknown as ValidationProviderRule["metadataSchema"],
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "github" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "github",
      snapshotRuleType: "default",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: true, provider: "github" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "github",
        success: true,
        metadata: githubMetadata,
      }),
    );
  });

  it("GitHub validation の入力形式が不正な場合は validate を呼ばずに INPUT_VALIDATION_ERROR を書き込む", async () => {
    const validateFn = vi.fn().mockResolvedValue({ isValid: true });
    const rule = makeRule({
      inputSchema: {
        parse: vi.fn().mockImplementation(() => {
          throw new Error("Invalid GitHub username");
        }),
      } as unknown as ValidationProviderRule["inputSchema"],
      validate: validateFn,
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "github" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "github",
      snapshotRuleType: "default",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Input validation failed" });
    expect(validateFn).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "github",
        success: false,
        errorCode: "INPUT_VALIDATION_ERROR",
        errorMessage: "Invalid input format",
      }),
    );
  });

  it.each([
    ["timeout", "TIMEOUT"],
    ["5xx", "GITHUB_API_ERROR"],
  ])("GitHub retryable %s result without retryAfter は最終試行前に BullMQ retry へ委譲し結果を書かない", async (_caseName, errorCode) => {
    const safeGitHubApiFailureMessage =
      "GitHub APIへの接続に失敗しました。しばらくしてから再試行してください";
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode,
        errorMessage: safeGitHubApiFailureMessage,
      }),
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "github" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "github",
      snapshotRuleType: "default",
      attemptsMade: 1,
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      safeGitHubApiFailureMessage,
    );

    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("GitHub retryable result without retryAfter は最終 BullMQ attempt で安全な失敗理由を書き込み遅延再試行しない", async () => {
    const safeGitHubApiFailureMessage =
      "GitHub APIへの接続に失敗しました。しばらくしてから再試行してください";
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "TIMEOUT",
        errorMessage: safeGitHubApiFailureMessage,
      }),
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "github" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "github",
      snapshotRuleType: "default",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "github",
        success: false,
        errorCode: "TIMEOUT",
        errorMessage: safeGitHubApiFailureMessage,
      }),
    );
    const writtenPayload = mockWriteValidationResult.mock.calls[0]?.[0];
    expect(writtenPayload?.errorMessage).not.toContain("api.github.com");
    expect(writtenPayload?.errorMessage).not.toContain("token=secret");
  });

  it("バリデーション失敗時にok:falseを返す", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        errorCode: "INVALID",
        errorMessage: "Not found",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, provider: "test-provider" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: "INVALID" }),
    );
  });

  it("Twitter validation 成功時はDB/SSE境界へCOMPLETED相当の結果を書き込む", async () => {
    const metadata = {
      username: "TwitterDev",
      userId: "123",
      displayName: "Twitter Dev",
      avatarUrl: "https://pbs.twimg.com/profile_images/twitter-dev.png",
      verified: true,
      profileUrl: "https://twitter.com/TwitterDev",
    };
    const rule = makeRule({
      metadataSchema: {
        safeParse: vi.fn().mockReturnValue({ success: true, data: metadata }),
      } as unknown as ValidationProviderRule["metadataSchema"],
      validate: vi.fn().mockResolvedValue({
        isValid: true,
        metadata,
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule, "twitter"));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "twitter",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: true, provider: "twitter" });
    expect(mockMarkValidationProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "twitter",
        jobId: "job-1",
      }),
    );
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "r-1",
        formId: "form-1",
        service: "twitter",
        success: true,
        metadata,
        jobId: "job-1",
      }),
    );
  });

  it("Twitter username の入力ミスは外部APIを呼ばず安全な失敗理由を書き込む", async () => {
    const validateFn = vi.fn();
    const inputParse = vi.fn().mockImplementation(() => {
      throw new Error("invalid username");
    });
    const rule = makeRule({
      inputSchema: {
        parse: inputParse,
      } as unknown as ValidationProviderRule["inputSchema"],
      validate: validateFn,
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule, "twitter"));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "twitter",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Input validation failed" });
    expect(validateFn).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "twitter",
        success: false,
        errorCode: "INPUT_VALIDATION_ERROR",
        errorMessage: "Invalid input format",
      }),
    );
  });

  it("retryAfterが設定されている場合は指定秒数だけ遅延して再試行させる", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({ isValid: false, retryAfter: 30 }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });
    const before = Date.now();

    await expect(
      handleGenericValidation(job, "lock-token"),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      "lock-token",
    );
    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterCount: 1 }),
    );
    const delayedUntil = vi.mocked(job.moveToDelayed).mock.calls[0]?.[0];
    expect(delayedUntil).toBeGreaterThanOrEqual(before + 30_000);
    expect(delayedUntil).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("Discord の長い retry_after は worker を sleep させず BullMQ delayed retry に委譲する", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryAfter: 600,
        retryable: true,
        errorCode: "DISCORD_API_RATE_LIMIT",
        errorMessage: "Discord API rate limit exceeded",
      }),
    });
    const provider = makeProvider(rule);
    mockProviderRegistryGet.mockReturnValue({ ...provider, name: "discord" });
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "discord",
    });
    const before = Date.now();

    await expect(
      handleGenericValidation(job, "lock-token"),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(mockWithRedisLock).toHaveBeenCalledWith(
      "nexus-form:discord-validation-api",
      expect.any(Function),
      expect.objectContaining({
        ttlMs: 120_000,
        waitTimeoutMs: 125_000,
      }),
    );
    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterCount: 1 }),
    );
    expect(job.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      "lock-token",
    );
    const delayedUntil = vi.mocked(job.moveToDelayed).mock.calls[0]?.[0];
    expect(delayedUntil).toBeGreaterThanOrEqual(before + 300_000);
    expect(delayedUntil).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("retryAfter が上限回数に到達した場合は FAILED として確定する", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryAfter: 30,
        retryable: true,
        errorCode: "RATE_LIMIT",
        errorMessage: "Rate limited",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      retryAfterCount: 3,
    });

    const result = await handleGenericValidation(job, "lock-token");

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: "RATE_LIMIT",
        errorMessage: "Rate limited",
      }),
    );
  });

  it("retryAfter が上限回数の直前なら遅延再試行する", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryAfter: 30,
        retryable: true,
        errorCode: "RATE_LIMIT",
        errorMessage: "Rate limited",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      retryAfterCount: 2,
    });

    await expect(
      handleGenericValidation(job, "lock-token"),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterCount: 3 }),
    );
    expect(job.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      "lock-token",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("backward-compat retryAfter が上限回数に到達した場合は FAILED として確定する", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryAfter: 30,
        errorCode: "RATE_LIMIT",
        errorMessage: "Rate limited",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      retryAfterCount: 3,
    });

    const result = await handleGenericValidation(job, "lock-token");

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: "RATE_LIMIT",
        errorMessage: "Rate limited",
      }),
    );
  });

  it("retryable result without retryAfter is thrown for BullMQ retry", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: "Temporary network error",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Temporary network error",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("Twitter 5xx retryable result は最終試行前にBullMQ retryへ委譲し内部詳細を書き込まない", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "TWITTER_API_ERROR",
        errorMessage: "Twitter API is temporarily unavailable",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule, "twitter"));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "twitter",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Twitter API is temporarily unavailable",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("retryable result without retryAfter is marked FAILED on the final BullMQ attempt", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: "Temporary network error",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: "Temporary network error",
      }),
    );
  });

  it("Twitter 5xx retry exhausted はPROCESSINGをFAILED相当に確定し内部詳細を漏らさない", async () => {
    const safeMessage = "Twitter API is temporarily unavailable";
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "TWITTER_API_ERROR",
        errorMessage: safeMessage,
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule, "twitter"));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "twitter",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "twitter",
        success: false,
        errorCode: "TWITTER_API_ERROR",
        errorMessage: safeMessage,
      }),
    );
    const writeParams = mockWriteValidationResult.mock.calls[0]?.[0];
    expect(writeParams?.errorMessage).not.toContain("api.twitter.com");
    expect(writeParams?.errorMessage).not.toContain("token");
    expect(writeParams?.errorMessage).not.toContain("trace");
  });

  it("Twitter timeout retry exhausted はPROCESSINGをFAILED相当に確定し低レベルtimeout文言を漏らさない", async () => {
    const safeMessage = "Request to Twitter API timed out";
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryable: true,
        errorCode: "TIMEOUT",
        errorMessage: safeMessage,
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule, "twitter"));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "twitter",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation result exhausted",
    });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "twitter",
        success: false,
        errorCode: "TIMEOUT",
        errorMessage: safeMessage,
      }),
    );
    const writeParams = mockWriteValidationResult.mock.calls[0]?.[0];
    expect(writeParams?.errorMessage).not.toContain("ETIMEDOUT");
    expect(writeParams?.errorMessage).not.toContain("api.twitter.com");
    expect(writeParams?.errorMessage).not.toContain("token");
  });

  it("成功 result に retryable が付いていても成功として処理する", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: true,
        retryable: true,
        retryAfter: 30,
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job, "lock-token");

    expect(result).toEqual({ ok: true, provider: "test-provider" });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
      }),
    );
  });

  it("retryAfter が負数の場合は遅延再試行として扱わない", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryAfter: -30,
        errorCode: "RATE_LIMIT_INVALID_RETRY_AFTER",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job, "lock-token");

    expect(result).toEqual({ ok: false, provider: "test-provider" });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: "RATE_LIMIT_INVALID_RETRY_AFTER",
      }),
    );
  });

  it("retryable false の retryAfter は遅延再試行として扱わない", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({
        isValid: false,
        retryAfter: 30,
        retryable: false,
        errorCode: "PERMANENT_ERROR",
        errorMessage: "Permanent failure",
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job, "lock-token");

    expect(result).toEqual({ ok: false, provider: "test-provider" });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: "PERMANENT_ERROR",
        errorMessage: "Permanent failure",
      }),
    );
  });

  it("normalizeInputが呼ばれ、正規化後の値でvalidateが実行される", async () => {
    const normalizeFn = vi.fn().mockReturnValue("normalized-input");
    const validateFn = vi.fn().mockResolvedValue({ isValid: true });
    const parseFn = vi.fn().mockImplementation((v: string) => v);

    const rule = makeRule({
      normalizeInput: normalizeFn,
      validate: validateFn,
      inputSchema: {
        parse: parseFn,
      } as unknown as ValidationProviderRule["inputSchema"],
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await handleGenericValidation(job);

    expect(normalizeFn).toHaveBeenCalledWith("test-input");
    expect(validateFn).toHaveBeenCalledWith(
      "normalized-input",
      expect.anything(),
    );
  });

  it("validate中のネットワークエラーはDBに書き込みok:falseを返す", async () => {
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(new Error("connection error")),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "connection error" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "VALIDATION_ERROR" }),
    );
  });

  it("リトライ可能なエラーはスローして再キューさせる (HTTP 429)", async () => {
    const rateLimitErr = Object.assign(new Error("Rate Limit Exceeded"), {
      status: 429,
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(rateLimitErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Rate Limit Exceeded",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("リトライ可能なエラーは最終 BullMQ attempt で FAILED として確定する", async () => {
    const rateLimitErr = Object.assign(new Error("Rate Limit Exceeded"), {
      status: 429,
      code: "RATE_LIMIT",
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(rateLimitErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      attemptsMade: 2,
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({
      ok: false,
      error: "Retryable validation error exhausted",
    });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: "RATE_LIMIT",
        errorMessage: "Rate Limit Exceeded",
      }),
    );
  });

  it("リトライ可能なエラーはスローして再キューさせる (Node.js ETIMEDOUT)", async () => {
    const timeoutErr = Object.assign(new Error("Connection timed out"), {
      code: "ETIMEDOUT",
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(timeoutErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Connection timed out",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("リトライ可能なエラーはスローして再キューさせる (axios形式 error.response.status 429)", async () => {
    const axiosErr = Object.assign(new Error("Rate Limit Exceeded"), {
      response: { status: 429 },
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(axiosErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Rate Limit Exceeded",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it.each([
    502, 503, 504,
  ])("リトライ可能なエラーはスローして再キューさせる (HTTP %i)", async (status) => {
    const gatewayErr = Object.assign(new Error(`Gateway error ${status}`), {
      status,
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(gatewayErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      `Gateway error ${status}`,
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it.each([
    "NETWORK_ERROR",
    "TIMEOUT",
    "GITHUB_API_RATE_LIMIT",
  ])("リトライ可能なエラーはスローして再キューさせる (プロバイダードメインコード %s)", async (code) => {
    const domainErr = Object.assign(new Error(`Provider error: ${code}`), {
      code,
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(domainErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      `Provider error: ${code}`,
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("response が null の provider error でも retryable code を保持する", async () => {
    const domainErr = Object.assign(new Error("Provider connection refused"), {
      code: "ECONNREFUSED",
      response: null,
    });
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(domainErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Provider connection refused",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("retryAfterプロパティを持つエラーはリトライさせる (コードもステータスも一致しない場合のみhasRetryAfterが有効)", async () => {
    // Uses an unrecognised code so the test would fail if hasRetryAfter were removed.
    const rateLimitErr = Object.assign(
      new Error("Custom provider rate limit"),
      {
        code: "CUSTOM_RATE_LIMIT",
        retryAfter: 60_000,
      },
    );
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(rateLimitErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Custom provider rate limit",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
  });

  it("retryAfter: 0 はリトライしない（ゼロはセンチネル値として扱う）", async () => {
    const zeroRetryErr = Object.assign(
      new Error("Rate limit with zero delay"),
      {
        code: "CUSTOM_RATE_LIMIT",
        retryAfter: 0,
      },
    );
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(zeroRetryErr),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);
    expect(result).toEqual({
      ok: false,
      error: "Rate limit with zero delay",
    });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "VALIDATION_ERROR" }),
    );
  });

  it("文字列のみのエラーメッセージはリトライしない", async () => {
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(new Error("rate limit exceeded")),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);
    expect(result).toEqual({ ok: false, error: "rate limit exceeded" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "VALIDATION_ERROR" }),
    );
  });

  it("sanitizeConfigが存在する場合に設定を変換してから渡す", async () => {
    const sanitizeFn = vi.fn().mockReturnValue({ sanitized: true });
    const validateFn = vi.fn().mockResolvedValue({ isValid: true });

    const rule = makeRule({
      sanitizeConfig: sanitizeFn,
      validate: validateFn,
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await handleGenericValidation(job);

    expect(sanitizeFn).toHaveBeenCalledWith({ raw: "value" });
    expect(rule.configSchema.parse).toHaveBeenCalledWith({
      sanitized: true,
    });
  });

  it("normalizeInputが例外をスローした場合にINPUT_VALIDATION_ERRORを返す", async () => {
    const rule = makeRule({
      normalizeInput: vi.fn().mockImplementation(() => {
        throw new Error("Invalid format");
      }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: false, error: "Input normalization failed" });
    expect(mockWriteValidationResult).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "INPUT_VALIDATION_ERROR" }),
    );
  });

  it("snapshotConfigJsonが設定されている場合はliveルールのconfigJsonより優先する", async () => {
    const validateFn = vi.fn().mockResolvedValue({ isValid: true });
    const rule = makeRule({ validate: validateFn });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));

    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "test-provider",
      snapshotRuleType: "default",
      snapshotConfigJson: { snapshot: "config" },
    });

    await handleGenericValidation(job);

    // configSchema.parse は snapshotConfigJson の値で呼ばれるべき
    expect(rule.configSchema.parse).toHaveBeenCalledWith({
      snapshot: "config",
    });
  });

  it("snapshotProviderNameが設定されている場合はliveルールのproviderNameより優先する", async () => {
    const snapshotRule = makeRule({ name: "default" });
    const snapshotProvider: ValidationProvider = {
      name: "snapshot-provider",
      label: "Snapshot",
      description: "Snapshot provider",
      rules: { default: snapshotRule },
    };

    mockProviderRegistryGet.mockImplementation((name: string) => {
      if (name === "snapshot-provider") return snapshotProvider;
      return undefined;
    });

    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
      snapshotProviderName: "snapshot-provider",
      snapshotRuleType: "default",
      snapshotConfigJson: {},
    });

    const result = await handleGenericValidation(job);

    expect(result).toEqual({ ok: true, provider: "snapshot-provider" });
    expect(mockProviderRegistryGet).toHaveBeenCalledWith("snapshot-provider");
  });
});
