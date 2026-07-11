/**
 * Generic Validation Handler
 *
 * Plugin Registry を使用して動的にプロバイダーを選択し、
 * `(ruleId, referencedBlockId)` ペア単位で検証を実行する。
 */

import {
  providerRegistry,
  type ValidationProviderExecutionContext,
  validationProviderResultSchema,
} from "@nexus-form/integrations";
import {
  type GenericValidationJobData,
  genericValidationJobDataSchema,
  mergeValidationOutputValuesIntoMetadata,
  VALIDATION_REVALIDATION_JOB_PREFIX,
} from "@nexus-form/shared";
import { DelayedError, type Job } from "bullmq";
import { ZodError, z } from "zod";
import { getValidationPluginTimeoutMs } from "../lib/env";
import { RedisLockAcquireTimeoutError, withRedisLock } from "../lib/redis-lock";
import { workerShutdownSignal } from "../lib/shutdown-signal";
import {
  ConcurrentDeleteError,
  FormResponseNotFoundError,
  getValidationContext,
  markValidationProcessing,
  ReferencedBlockMissingError,
  StaleValidationJobError,
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
// NETWORK_ERROR / TIMEOUT / GITHUB_API_RATE_LIMIT are included for providers or
// refactored plugin paths that re-throw domain errors directly. GitHub currently
// catches them inside validate() and returns retryable ValidationProviderResult
// objects, which are handled in the result-processing path below.
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
  // Host deadline failures are retryable; a final attempt records this code.
  "VALIDATION_PLUGIN_TIMEOUT",
]);

const VALIDATION_PLUGIN_TIMEOUT_ERROR_CODE = "VALIDATION_PLUGIN_TIMEOUT";

class ValidationPluginTimeoutError extends Error {
  readonly code = VALIDATION_PLUGIN_TIMEOUT_ERROR_CODE;

  constructor(deadlineAt: number) {
    super(`Validation plugin exceeded host deadline at ${deadlineAt}`);
    this.name = "ValidationPluginTimeoutError";
  }
}

type ValidationExecution = (
  context: ValidationProviderExecutionContext,
) => Promise<unknown>;

type ValidationExecutionOutcome =
  | { kind: "fulfilled"; value: unknown }
  | { kind: "rejected"; error: unknown };

async function runValidationWithDeadline(
  execute: ValidationExecution,
): Promise<unknown> {
  const timeoutMs = getValidationPluginTimeoutMs();
  const deadlineAt = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timeoutError = new ValidationPluginTimeoutError(deadlineAt);

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let shutdownReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });

  const scheduleShutdownRelease = (reason: unknown): void => {
    if (shutdownReleaseTimer !== undefined) return;
    shutdownReleaseTimer = setTimeout(() => {
      rejectAbort?.(reason);
    }, 0);
  };

  const abortFromShutdown = (): void => {
    const reason =
      workerShutdownSignal.reason ??
      new DOMException("Worker shutting down", "AbortError");
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
    // Let a provider rejection that is already in flight win over the host's
    // shutdown cancellation, while still releasing a signal-ignoring plugin.
    scheduleShutdownRelease(reason);
  };

  if (workerShutdownSignal.aborted) {
    abortFromShutdown();
  } else {
    workerShutdownSignal.addEventListener("abort", abortFromShutdown, {
      once: true,
    });
  }

  timeoutTimer = setTimeout(() => {
    if (controller.signal.aborted) return;
    controller.abort(timeoutError);
    // A host deadline is terminal even if the plugin resolves from its abort
    // handler. The late promise remains observed below.
    rejectAbort?.(timeoutError);
  }, timeoutMs);

  const validationPromise = controller.signal.aborted
    ? Promise.resolve().then(() => {
        throw (
          controller.signal.reason ??
          new DOMException("Worker shutting down", "AbortError")
        );
      })
    : Promise.resolve().then(() =>
        execute({ signal: controller.signal, deadlineAt }),
      );
  const observedValidationPromise: Promise<ValidationExecutionOutcome> =
    validationPromise.then(
      (value) => ({ kind: "fulfilled", value }),
      (error) => ({ kind: "rejected", error }),
    );

  try {
    const outcome = await Promise.race([
      observedValidationPromise,
      abortPromise,
    ]);
    if (outcome.kind === "rejected") throw outcome.error;
    return outcome.value;
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (shutdownReleaseTimer !== undefined) {
      clearTimeout(shutdownReleaseTimer);
    }
    workerShutdownSignal.removeEventListener("abort", abortFromShutdown);
  }
}

function throwIfShuttingDown(): void {
  if (workerShutdownSignal.aborted) {
    throw (
      workerShutdownSignal.reason ??
      new DOMException("Worker shutting down", "AbortError")
    );
  }
}

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
  if (error instanceof RedisLockAcquireTimeoutError) return true;
  // Lock wait AbortError/TimeoutError is transient. Worker shutdown AbortError
  // is intercepted by isShutdownAbortError before this helper is called.
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  return false;
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

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "AbortError";
}

function isShutdownAbortError(error: unknown): error is DOMException {
  return isAbortError(error) && error === workerShutdownSignal.reason;
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
  throwIfShuttingDown();

  const jobData = genericValidationJobDataSchema.parse(job.data);
  const { responseId, ruleId, referencedBlockId, snapshotVersion } = jobData;

  let context: Awaited<ReturnType<typeof getValidationContext>>;
  try {
    context = await getValidationContext(
      responseId,
      ruleId,
      referencedBlockId,
      snapshotVersion,
    );
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
    if (
      job.id?.toString().startsWith(VALIDATION_REVALIDATION_JOB_PREFIX) &&
      error instanceof FormResponseNotFoundError &&
      error.responseId === responseId
    ) {
      return { ok: false, error: "Response deleted" };
    }
    throw error;
  }

  const { response, referencedValue } = context;
  const formId = response.formId;
  const serviceType = jobData.snapshotProviderName;
  const ruleType = jobData.snapshotRuleType;

  try {
    throwIfShuttingDown();
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
    if (error instanceof StaleValidationJobError) {
      return { ok: false, error: "Stale validation job" };
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
    throwIfShuttingDown();

    rawResult = await runValidationWithDeadline(async (executionContext) => {
      const runValidation = (): ReturnType<typeof providerRule.validate> =>
        providerRule.validate(validatedInput, providerConfig, executionContext);
      if (serviceType === DISCORD_PROVIDER_NAME) {
        try {
          return await withRedisLock(
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
              signal: executionContext.signal,
            },
          );
        } catch (error) {
          if (executionContext.signal.aborted) {
            throw (
              executionContext.signal.reason ??
              new DOMException("Validation execution aborted", "AbortError")
            );
          }
          if (isShutdownAbortError(error)) {
            throw error;
          }
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
      }
      return runValidation();
    });
  } catch (error) {
    if (isShutdownAbortError(error) && !isFinalBullMqAttempt(job)) {
      // Retry re-enters markValidationProcessing against the same PROCESSING
      // row/jobId. mysql2 counts matched rows via CLIENT_FOUND_ROWS by default,
      // so the idempotent PROCESSING -> PROCESSING update is accepted.
      throw error;
    }
    if (isAbortError(error) && isFinalBullMqAttempt(job)) {
      await writeValidationResult({
        responseId,
        formId,
        ruleId,
        referencedBlockId,
        service: serviceType,
        success: false,
        errorCode: "VALIDATION_ABORTED_DURING_SHUTDOWN",
        errorMessage:
          error.message || "Validation job interrupted during shutdown",
        jobId: job.id?.toString(),
      });
      return { ok: false, error: "Validation interrupted during shutdown" };
    }
    if (isAbortError(error)) {
      throw error;
    }
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
    metadata: mergeValidationOutputValuesIntoMetadata(
      validatedMetadata,
      result.outputValues,
    ),
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    jobId: job.id?.toString(),
  });

  return { ok: result.isValid, provider: provider.name };
};

export default handleGenericValidation;
