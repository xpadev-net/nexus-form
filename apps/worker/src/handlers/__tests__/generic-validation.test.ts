import {
  providerRegistry,
  type ValidationProvider,
  type ValidationProviderRule,
} from "@nexus-form/integrations";
import type { Job } from "bullmq";
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
    ReferencedBlockMissingError,
  };
});

import {
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  writeValidationResult,
} from "../../lib/validation-helpers";

const mockGetValidationContext = vi.mocked(getValidationContext);
const mockMarkValidationProcessing = vi.mocked(markValidationProcessing);
const mockWriteValidationResult = vi.mocked(writeValidationResult);
const mockProviderRegistryGet = vi.mocked(providerRegistry.get);

function makeJob(data: {
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  snapshotProviderName?: string;
  snapshotRuleType?: string;
  snapshotConfigJson?: Record<string, unknown>;
}): Job {
  return {
    id: "job-1",
    data: {
      snapshotProviderName: "test-provider",
      snapshotRuleType: "default",
      snapshotConfigJson: { raw: "value" },
      ...data,
    },
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

  it("retryAfterが設定されている場合はエラーをスローしてリトライさせる", async () => {
    const rule = makeRule({
      validate: vi.fn().mockResolvedValue({ isValid: false, retryAfter: 30 }),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "Rate limited, retry after 30s",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
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

  it("リトライ可能なエラーはスローして再キューさせる", async () => {
    const rule = makeRule({
      validate: vi.fn().mockRejectedValue(new Error("rate limit exceeded")),
    });
    mockProviderRegistryGet.mockReturnValue(makeProvider(rule));
    const job = makeJob({
      responseId: "r-1",
      ruleId: "rule-1",
      referencedBlockId: "block-a",
    });

    await expect(handleGenericValidation(job)).rejects.toThrow(
      "rate limit exceeded",
    );
    expect(mockWriteValidationResult).not.toHaveBeenCalled();
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
