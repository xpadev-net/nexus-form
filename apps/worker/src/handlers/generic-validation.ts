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
import { DelayedError, type Job } from "bullmq";
import { ZodError } from "zod";
import {
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  writeValidationResult,
} from "../lib/validation-helpers";

function logZodError(prefix: string, err: unknown): void {
  if (err instanceof ZodError) {
    console.error(prefix, {
      issueCount: err.issues.length,
      paths: err.issues.map((i) => i.path.join(".")),
    });
  } else {
    console.error(prefix, {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]); // 429 rate-limit; 502/503/504 transient gateway errors
// NETWORK_ERROR / TIMEOUT: included for future providers or refactored plugin
// paths that re-throw these codes directly. The current validation-provider-github
// catches them inside validate() and returns a non-retryable GITHUB_API_ERROR
// result, so these entries have no effect for that provider today.
// GITHUB_API_RATE_LIMIT is also caught inside plugin.ts validate() and converted
// to a result with retryAfter (handled by the `if (result.retryAfter)` throw
// in the result-processing path below), so it likewise has no effect via this
// set for the current GitHub provider.
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
  token?: string,
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
    logZodError("[generic-validation] CONFIG_VALIDATION_ERROR", zodError);
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "CONFIG_VALIDATION_ERROR",
      errorMessage: "Invalid provider configuration",
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Config validation failed" };
  }

  let validatedInput: string;
  try {
    validatedInput = providerRule.inputSchema.parse(referencedValue);
  } catch (zodError) {
    logZodError("[generic-validation] INPUT_VALIDATION_ERROR", zodError);
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "INPUT_VALIDATION_ERROR",
      errorMessage: "Invalid input format",
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Input validation failed" };
  }

  if (providerRule.normalizeInput) {
    try {
      validatedInput = providerRule.normalizeInput(validatedInput);
      validatedInput = providerRule.inputSchema.parse(validatedInput);
    } catch (normalizeError) {
      logZodError(
        "[generic-validation] INPUT_VALIDATION_ERROR (normalize)",
        normalizeError,
      );
      await writeValidationResult({
        responseId,
        formId,
        ruleId,
        referencedBlockId,
        service: serviceType,
        success: false,
        errorCode: "INPUT_VALIDATION_ERROR",
        errorMessage: "Input normalization failed",
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

    // Also retry if the provider set a strictly positive retryAfter on the error
    // (used by validation-provider-github for rate-limit back-off). Zero is
    // treated as unset to avoid retrying on accidental default values.
    const hasRetryAfter =
      typeof errObj?.retryAfter === "number" &&
      (errObj.retryAfter as number) > 0;
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
    logZodError(
      "[generic-validation] VALIDATION_RESULT_MALFORMED",
      resultParse.error,
    );
    await writeValidationResult({
      responseId,
      formId,
      ruleId,
      referencedBlockId,
      service: serviceType,
      success: false,
      errorCode: "VALIDATION_RESULT_MALFORMED",
      errorMessage: "Provider returned invalid result",
      jobId: job.id?.toString(),
    });
    return { ok: false, error: "Provider returned malformed result" };
  }
  const result = resultParse.data;

  if (result.retryAfter) {
    await job.moveToDelayed(Date.now() + result.retryAfter * 1000, token);
    throw new DelayedError();
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
