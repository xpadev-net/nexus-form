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
import {
  type GenericValidationJobData,
  genericValidationJobDataSchema,
} from "@nexus-form/shared";
import { DelayedError, type Job } from "bullmq";
import { ZodError, z } from "zod";
import { RedisLockAcquireTimeoutError, withRedisLock } from "../lib/redis-lock";
import {
  ConcurrentDeleteError,
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  ValidationCancelledError,
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
  "DISCORD_DISTRIBUTED_LOCK_TIMEOUT",
]);

const DISCORD_PROVIDER_NAME = "discord";
const DISCORD_VALIDATION_LOCK_KEY = "nexus-form:discord-validation-api";
const DEFAULT_DISCORD_VALIDATION_LOCK_TTL_MS = 120_000;
const DEFAULT_DISCORD_VALIDATION_LOCK_WAIT_TIMEOUT_MS = 125_000;
const DEFAULT_MAX_RETRY_AFTER_SECONDS = 300;
const DEFAULT_RETRY_AFTER_MAX_ATTEMPTS = 3;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Math.trunc(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRedisLockAcquireTimeout(error: unknown): boolean {
  return error instanceof RedisLockAcquireTimeoutError;
}

function getRetryAfterAttemptsLimit(): number {
  return readPositiveIntegerEnv(
    "VALIDATION_RETRY_AFTER_MAX_ATTEMPTS",
    DEFAULT_RETRY_AFTER_MAX_ATTEMPTS,
  );
}

function getRetryAfterSeconds(retryAfter: number): number {
  const maxRetryAfterSeconds = readPositiveIntegerEnv(
    "VALIDATION_RETRY_AFTER_MAX_SECONDS",
    DEFAULT_MAX_RETRY_AFTER_SECONDS,
  );
  return Math.min(Math.ceil(retryAfter), maxRetryAfterSeconds);
}

function isFinalBullMqAttempt(job: Job<GenericValidationJob>): boolean {
  const attempts =
    typeof job.opts.attempts === "number" && job.opts.attempts > 0
      ? job.opts.attempts
      : 1;
  return (job.attemptsMade ?? 0) + 1 >= attempts;
}

const providerErrorSchema = z
  .object({
    code: z.string().optional().catch(undefined),
    status: z.number().optional().catch(undefined),
    retryAfter: z.number().optional().catch(undefined),
    response: z.preprocess(
      (value) => (value === null ? undefined : value),
      z
        .object({
          status: z.number().optional().catch(undefined),
        })
        .optional()
        .catch(undefined),
    ),
  })
  .passthrough();

const metadataRecordSchema = z.record(z.string(), z.unknown());

export type GenericValidationJob = GenericValidationJobData;

export const handleGenericValidation = async (
  job: Job<GenericValidationJob>,
  token?: string,
) => {
  const jobData = genericValidationJobDataSchema.parse(job.data);
  const { responseId, ruleId, referencedBlockId } = jobData;

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
  const serviceType = jobData.snapshotProviderName;
  const ruleType = jobData.snapshotRuleType;

  try {
    await markValidationProcessing({
      responseId,
      ruleId,
      referencedBlockId,
      formId,
      service: serviceType,
      jobId: job.id?.toString(),
    });
  } catch (error) {
    if (error instanceof ValidationCancelledError) {
      return { ok: false, error: "Validation cancelled" };
    }
    if (error instanceof ConcurrentDeleteError) {
      return { ok: false, error: "Result row deleted" };
    }
    throw error;
  }

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

  const rawProviderConfig = jobData.snapshotConfigJson;
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
    const runValidation = (): ReturnType<typeof providerRule.validate> =>
      providerRule.validate(validatedInput, providerConfig);
    if (serviceType === DISCORD_PROVIDER_NAME) {
      try {
        rawResult = await withRedisLock(
          DISCORD_VALIDATION_LOCK_KEY,
          runValidation,
          {
            ttlMs: readPositiveIntegerEnv(
              "DISCORD_VALIDATION_LOCK_TTL_MS",
              DEFAULT_DISCORD_VALIDATION_LOCK_TTL_MS,
            ),
            waitTimeoutMs: readPositiveIntegerEnv(
              "DISCORD_VALIDATION_LOCK_WAIT_TIMEOUT_MS",
              DEFAULT_DISCORD_VALIDATION_LOCK_WAIT_TIMEOUT_MS,
            ),
          },
        );
      } catch (error) {
        if (isRedisLockAcquireTimeout(error)) {
          throw Object.assign(
            error instanceof Error ? error : new Error(String(error)),
            {
              code: "DISCORD_DISTRIBUTED_LOCK_TIMEOUT",
            },
          );
        }
        throw error;
      }
    } else {
      rawResult = await runValidation();
    }
  } catch (error) {
    const providerErrorParse = providerErrorSchema.safeParse(error);
    const providerError = providerErrorParse.success
      ? providerErrorParse.data
      : null;
    const errorCode = providerError?.code;
    const responseStatus = providerError?.response?.status;
    const errorStatus =
      providerError?.status !== undefined
        ? providerError.status
        : responseStatus !== undefined
          ? responseStatus
          : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Also retry if the provider set a strictly positive retryAfter on the error
    // (used by validation-provider-github for rate-limit back-off). Zero is
    // treated as unset to avoid retrying on accidental default values.
    const hasRetryAfter =
      providerError?.retryAfter !== undefined && providerError.retryAfter > 0;
    const isRetryable =
      (errorCode !== undefined && RETRYABLE_CODES.has(errorCode)) ||
      (errorStatus !== undefined && RETRYABLE_HTTP_STATUSES.has(errorStatus)) ||
      hasRetryAfter;

    if (isRetryable && isFinalBullMqAttempt(job)) {
      await writeValidationResult({
        responseId,
        formId,
        ruleId,
        referencedBlockId,
        service: serviceType,
        success: false,
        errorCode: errorCode ?? "VALIDATION_RETRY_EXHAUSTED",
        errorMessage: errorMessage || "Retryable validation error exhausted",
        jobId: job.id?.toString(),
      });
      return { ok: false, error: "Retryable validation error exhausted" };
    }

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

  if (!result.isValid && result.retryable) {
    if (result.retryAfter != null && result.retryAfter > 0) {
      const retryAfterCount = jobData.retryAfterCount ?? 0;
      if (retryAfterCount >= getRetryAfterAttemptsLimit()) {
        await writeValidationResult({
          responseId,
          formId,
          ruleId,
          referencedBlockId,
          service: serviceType,
          success: false,
          errorCode: result.errorCode ?? "VALIDATION_RETRY_EXHAUSTED",
          errorMessage:
            result.errorMessage ?? "Retryable validation result exhausted",
          jobId: job.id?.toString(),
        });
        return { ok: false, error: "Retryable validation result exhausted" };
      }

      const retryAfterSeconds = getRetryAfterSeconds(result.retryAfter);
      await job.updateData({
        ...job.data,
        retryAfterCount: retryAfterCount + 1,
      });
      await job.moveToDelayed(Date.now() + retryAfterSeconds * 1000, token);
      throw new DelayedError();
    }

    if (isFinalBullMqAttempt(job)) {
      await writeValidationResult({
        responseId,
        formId,
        ruleId,
        referencedBlockId,
        service: serviceType,
        success: false,
        errorCode: result.errorCode ?? "VALIDATION_RETRY_EXHAUSTED",
        errorMessage:
          result.errorMessage ?? "Retryable validation result exhausted",
        jobId: job.id?.toString(),
      });
      return { ok: false, error: "Retryable validation result exhausted" };
    }

    throw new Error(result.errorMessage ?? "Retryable validation result");
  }

  if (
    !result.isValid &&
    result.retryable !== false &&
    result.retryAfter != null &&
    result.retryAfter > 0
  ) {
    const retryAfterCount = jobData.retryAfterCount ?? 0;
    if (retryAfterCount >= getRetryAfterAttemptsLimit()) {
      await writeValidationResult({
        responseId,
        formId,
        ruleId,
        referencedBlockId,
        service: serviceType,
        success: false,
        errorCode: result.errorCode ?? "VALIDATION_RETRY_EXHAUSTED",
        errorMessage:
          result.errorMessage ?? "Retryable validation result exhausted",
        jobId: job.id?.toString(),
      });
      return { ok: false, error: "Retryable validation result exhausted" };
    }

    const retryAfterSeconds = getRetryAfterSeconds(result.retryAfter);
    await job.updateData({
      ...job.data,
      retryAfterCount: retryAfterCount + 1,
    });
    await job.moveToDelayed(Date.now() + retryAfterSeconds * 1000, token);
    throw new DelayedError();
  }

  let validatedMetadata: Record<string, unknown> | undefined;
  if (result.metadata !== undefined) {
    const metadataParsed = providerRule.metadataSchema.safeParse(
      result.metadata,
    );
    if (metadataParsed.success) {
      const metadataRecordParsed = metadataRecordSchema.safeParse(
        metadataParsed.data,
      );
      if (metadataRecordParsed.success) {
        validatedMetadata = metadataRecordParsed.data;
      } else {
        console.warn(
          `[generic-validation] Metadata must be an object for ${provider.name}.${providerRule.name}:`,
          metadataRecordParsed.error.message,
        );
        validatedMetadata = undefined;
      }
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
