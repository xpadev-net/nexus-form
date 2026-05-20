import {
  providerRegistry,
  type ValidationProvider,
  type ValidationProviderRule,
} from "@nexus-form/integrations";
import { DelayedError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGenericValidation } from "../generic-validation";

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
  ValidationCancelledError,
  writeValidationResult,
} from "../../lib/validation-helpers";

const mockGetValidationContext = vi.mocked(getValidationContext);
const mockMarkValidationProcessing = vi.mocked(markValidationProcessing);
const mockWriteValidationResult = vi.mocked(writeValidationResult);
const mockProviderRegistryGet = vi.mocked(providerRegistry.get);
const mockWithRedisLock = vi.mocked(withRedisLock);

function makeJob(data: {
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
  const { attemptsMade, ...jobData } = data;
  return {
    id: "job-1",
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
): ValidationProvider {
  return {
    name: "test-provider",
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
