/**
 * Generic Validation Handler
 *
 * Plugin Registry を使用して動的にプロバイダーを選択し、
 * `(ruleId, referencedBlockId)` ペア単位で検証を実行する。
 */

import {
  providerRegistry,
  validationProviderResultSchema,
} from "@nexus-form/integrations";
import type { Job } from "bullmq";
import {
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  writeValidationResult,
} from "../lib/validation-helpers";

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
// Include provider-domain codes: validation-provider-github remaps syscall
// errors to NETWORK_ERROR / TIMEOUT and rate limits to GITHUB_API_RATE_LIMIT
// before re-throwing, so raw syscall codes never surface on those errors.
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "EAI_AGAIN",
  "NETWORK_ERROR",
  "TIMEOUT",
  "GITHUB_API_RATE_LIMIT",
]);

export type GenericValidationJob = {
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  snapshotProviderName: string;
  snapshotRuleType: string;
  snapshotConfigJson: Record<string, unknown>;
};

export const handleGenericValidation = async (
  job: Job<GenericValidationJob>,
) => {
  const { responseId, ruleId, referencedBlockId } = job.data;

  let context: Awaited<ReturnType<typeof getValidationContext>>;
  try {
    context = await getValidationContext(responseId, ruleId, referencedBlockId);
  } catch (error) {
    if (error instanceof ReferencedBlockMissingError) {
      // ジョブ enqueue 後に参照ブロックが削除されたケース。
      // 状態を MISSING にして終了する。
      await writeValidationResult({
        responseId,
        formId: error.formId,
        ruleId,
        referencedBlockId,
        service: "",
        status: "MISSING",
        success: null,
        errorCode: "REFERENCED_BLOCK_MISSING",
        errorMessage: error.message,
        jobId: job.id?.toString(),
      });
      return { ok: false, error: "Referenced block missing" };
    }
    throw error;
  }

  const { response, referencedValue } = context;
  const formId = response.formId;
  const serviceType = job.data.snapshotProviderName;
  const ruleType = job.data.snapshotRuleType;

  await markValidationProcessing({
    responseId,
    ruleId,
    referencedBlockId,
    formId,
    service: serviceType,
  });

  const provider = providerRegistry.get(serviceType);
  const providerRule = provider?.rules[ruleType];
  if (!provider || !providerRule) {
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: provider ? "UNKNOWN_RULE_TYPE" : "PROVIDER_NOT_FOUND",
      errorMessage: provider
        ? `Provider ${serviceType} does not expose rule: ${ruleType}`
        : `Provider ${serviceType} is not registered`,
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Provider rule not found" };
  }

  const rawProviderConfig = job.data.snapshotConfigJson;
  const sanitizedConfig = providerRule.sanitizeConfig
    ? providerRule.sanitizeConfig(rawProviderConfig)
    : rawProviderConfig;

  let providerConfig: Record<string, unknown>;
  try {
    providerConfig = providerRule.configSchema.parse(sanitizedConfig);
  } catch (zodError) {
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "CONFIG_VALIDATION_ERROR",
      errorMessage:
        zodError instanceof Error
          ? zodError.message
          : "Invalid provider config",
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Config validation failed" };
  }

  let validatedInput: string;
  try {
    validatedInput = providerRule.inputSchema.parse(referencedValue);
  } catch (zodError) {
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "INPUT_VALIDATION_ERROR",
      errorMessage:
        zodError instanceof Error ? zodError.message : "Invalid input",
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Input validation failed" };
  }

  if (providerRule.normalizeInput) {
    try {
      validatedInput = providerRule.normalizeInput(validatedInput);
      validatedInput = providerRule.inputSchema.parse(validatedInput);
    } catch (normalizeError) {
      await writeValidationResult({
        responseId,
        formId,
        ruleId,
        referencedBlockId,
        service: serviceType,
        success: false,
        errorCode: "INPUT_VALIDATION_ERROR",
        errorMessage:
          normalizeError instanceof Error
            ? normalizeError.message
            : "Input normalization failed",
        jobId: job.id?.toString(),
      });
      return { ok: false, error: "Input normalization failed" };
    }
  }

  let rawResult: unknown;
  try {
    rawResult = await providerRule.validate(validatedInput, providerConfig);
  } catch (error) {
    const errObj =
      error !== null && typeof error === "object"
        ? (error as Record<string, unknown>)
        : null;
    const errorCode =
      typeof errObj?.code === "string" ? errObj.code : undefined;
    const responseStatus = (
      errObj?.response as Record<string, unknown> | undefined
    )?.status;
    const errorStatus =
      typeof errObj?.status === "number"
        ? errObj.status
        : typeof responseStatus === "number"
          ? responseStatus
          : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Also retry if the provider set a numeric retryAfter on the error object
    // (used by validation-provider-github for rate-limit back-off).
    const hasRetryAfter = typeof errObj?.retryAfter === "number";
    const isRetryable =
      (errorCode !== undefined && RETRYABLE_CODES.has(errorCode)) ||
      (errorStatus !== undefined && RETRYABLE_HTTP_STATUSES.has(errorStatus)) ||
      hasRetryAfter;

    if (isRetryable) {
      throw error;
    }

    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "VALIDATION_ERROR",
      errorMessage,
      jobId: job.id?.toString(),
    });

    return { ok: false, error: errorMessage };
  }

  const resultParse = validationProviderResultSchema.safeParse(rawResult);
  if (!resultParse.success) {
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "VALIDATION_RESULT_MALFORMED",
      errorMessage: `Provider returned malformed result: ${resultParse.error.message}`,
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Provider returned malformed result" };
  }
  const result = resultParse.data;

  if (result.retryAfter) {
    throw new Error(`Rate limited, retry after ${result.retryAfter}s`);
  }

  let validatedMetadata: Record<string, unknown> | undefined;
  if (result.metadata !== undefined) {
    const metadataParsed = providerRule.metadataSchema.safeParse(
      result.metadata,
    );
    if (metadataParsed.success) {
      validatedMetadata = metadataParsed.data as Record<string, unknown>;
    } else {
      console.warn(
        `[generic-validation] Metadata schema validation failed for ${provider.name}.${providerRule.name}:`,
        metadataParsed.error.message,
      );
      validatedMetadata = undefined;
    }
  }

  await writeValidationResult({
    responseId,
    formId,
    ruleId,
    referencedBlockId,
    service: serviceType,
    success: result.isValid,
    metadata: validatedMetadata,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    jobId: job.id?.toString(),
  });

  return { ok: result.isValid, provider: provider.name };
};

export default handleGenericValidation;
