import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  fingerprintDetail,
  form,
  formResponse,
  formValidationRule,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import type { ValidationStatusValue } from "@nexus-form/shared";
import {
  genericValidationJobDataSchema,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RESPONSE_ID_LENGTH,
  MAX_RESPONSE_ITEMS,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import { buildQuestionsFromPlateContent } from "../lib/forms/plate-question-builder";
import { validateResponseData } from "../lib/forms/response-validator";
import {
  getLatestSnapshotByVersion,
  getSnapshotByVersion,
} from "../lib/forms/snapshot-repository";
import { getExternalValidationResults } from "../lib/forms/validation-results";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { logError, logWarn } from "../lib/logger";
import { getValidationQueue, isValidServiceName } from "../lib/queues";
import { createRateLimit } from "../lib/rate-limit";
import { createRequestBodySizeLimit } from "../lib/request-body-size-limit";
import { stringifyResponseDataJson } from "../lib/response-data-json";
import { errorResponse } from "../types/domain/common";
import {
  BulkDeleteResponseSchema,
  InvalidResponseDataErrorResponseSchema,
  ResponseDetailResponseSchema,
  ResponseIdsResponseSchema,
  ResponseMutationResponseSchema,
  ResponsesListResponseSchema,
  ValidationRetryEnqueueErrorResponseSchema,
  ValidationRetryResponseSchema,
} from "../types/domain/form-responses";
import { OkResponseSchema } from "../types/domain/form-row";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const MAX_USER_AGENT_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 128;
const VALIDATION_RETRY_CLAIM_LEASE_MS = 5 * 60 * 1000;
const responseBodySizeLimit = createRequestBodySizeLimit({
  maxBytes: MAX_RESPONSE_BODY_BYTES,
});
const LIKE_ESCAPE_CHAR = "!";

const listResponsesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  keyword: z.string().max(200).optional(),
  sort: z.enum(["submittedAt", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const limitedListQuerySchema = paginationQuerySchema;

const createResponseSchema = z.object({
  responses: z.array(responsePayloadItemSchema).max(MAX_RESPONSE_ITEMS),
  respondentUuid: z.string().max(MAX_RESPONSE_ID_LENGTH).optional(),
  userAgent: z.string().max(MAX_USER_AGENT_LENGTH).optional(),
  sessionId: z.string().max(MAX_SESSION_ID_LENGTH).optional(),
  countryCode: z.string().max(10).optional(),
});

const updateResponseSchema = z.object({
  responses: z.array(responsePayloadItemSchema).max(MAX_RESPONSE_ITEMS),
});

const bulkRetrySchema = z.object({
  validationResultIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100, "Cannot retry more than 100 validation results at once"),
});

const cancellableValidationStatuses = new Set<ValidationStatusValue>([
  "PENDING",
  "PROCESSING",
  "FAILED",
]);

function cancellableValidationStatusCondition() {
  return or(
    eq(externalServiceValidationResult.status, "PENDING"),
    eq(externalServiceValidationResult.status, "PROCESSING"),
    eq(externalServiceValidationResult.status, "FAILED"),
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`);
}

function buildPrefixSearchPattern(keyword: string): string {
  return `${escapeLikePattern(keyword)}%`;
}

const bulkDeleteSchema = z.object({
  responseIds: z
    .array(z.string().min(1))
    .min(1, "At least one response ID is required")
    .max(100, "Cannot delete more than 100 responses at once"),
});

function snapshotRuleMapKey(
  formId: string,
  snapshotVersion: number | null,
  ruleId: string,
): string {
  return `${formId}:${snapshotVersion ?? "latest"}:${ruleId}`;
}

function validationRetryClaimableCondition(now: Date) {
  return and(
    ne(externalServiceValidationResult.status, "PROCESSING"),
    or(
      ne(externalServiceValidationResult.status, "PENDING"),
      sql`${externalServiceValidationResult.nextRetryAt} <= ${now}`,
    ),
  );
}

/**
 * validation result 行を lease 付きで PENDING に claim してから BullMQ ジョブを投入する。
 * claim に失敗した result は並行 retry 済みとして enqueue しない。bulk retry でも
 * claim はレコードごとに行うため、最大 100 件では 100 回の UPDATE になるが、
 * 同一 result の二重 enqueue を避けるためこの順序を優先する。
 *
 * @returns enqueuedCount は claim と BullMQ キュー投入の両方に成功した件数。
 *          enqueue 失敗時は同じ jobId を保持している行だけ FAILED に戻す。
 */
export async function enqueueValidationRetries(
  results: Array<{
    id: string;
    responseId: string;
    ruleId: string;
    referencedBlockId: string;
    service: string | null;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MISSING";
    formId: string;
    snapshotVersion: number | null;
    liveRuleType: string | null;
    liveConfigJson: unknown;
  }>,
): Promise<{ jobIds: string[]; enqueuedCount: number; skippedCount: number }> {
  // MISSING は参照ブロック自体が存在しないため retry 不可。
  const retryable = results.filter((r) => r.status !== "MISSING");
  for (const r of results) {
    if (r.status === "MISSING") {
      logWarn(
        "Skipping validation retry because referenced block is missing",
        "forms-responses",
        {
          resultId: r.id,
          responseId: r.responseId,
          ruleId: r.ruleId,
          referencedBlockId: r.referencedBlockId,
          formId: r.formId,
        },
      );
    }
  }

  const validResults = retryable.filter(
    (r): r is typeof r & { service: string } => r.service != null,
  );
  if (validResults.length === 0)
    return { jobIds: [], enqueuedCount: 0, skippedCount: results.length };

  // ルールが draft から削除されている場合、active スナップショットをフォールバックとして使用する。
  const needsFallback = validResults.filter(
    (r) => r.liveRuleType === null || r.liveConfigJson === null,
  );
  const snapshotRuleMap = new Map<
    string,
    { ruleType: string; configJson: Record<string, unknown> }
  >();
  if (needsFallback.length > 0) {
    const snapshotKeys = new Map(
      needsFallback.map((r) => [
        `${r.formId}:${r.snapshotVersion ?? "latest"}`,
        { formId: r.formId, snapshotVersion: r.snapshotVersion },
      ]),
    );
    for (const { formId: fid, snapshotVersion } of snapshotKeys.values()) {
      const snapshot =
        snapshotVersion === null || snapshotVersion === undefined
          ? await getLatestSnapshotByVersion(fid)
          : await getSnapshotByVersion(fid, snapshotVersion);
      if (snapshot?.validationRulesJson) {
        for (const entry of parseValidationRuleSnapshot(
          snapshot.validationRulesJson,
        )) {
          snapshotRuleMap.set(
            snapshotRuleMapKey(fid, snapshotVersion, entry.id),
            {
              ruleType: entry.ruleType,
              configJson: entry.configJson,
            },
          );
        }
      }
    }
  }

  const jobIds: string[] = [];
  const preparedJobs: Array<{
    result: (typeof validResults)[number];
    jobData: z.infer<typeof genericValidationJobDataSchema>;
    jobId: string;
  }> = [];
  let enqueuedCount = 0;

  for (const result of validResults) {
    if (!isValidServiceName(result.service)) {
      logWarn(
        "Skipping validation retry because service name is invalid",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
        },
      );
      continue;
    }

    const snapshotEntry = snapshotRuleMap.get(
      snapshotRuleMapKey(result.formId, result.snapshotVersion, result.ruleId),
    );
    const ruleType = result.liveRuleType ?? snapshotEntry?.ruleType ?? null;
    const configJson =
      (isRecord(result.liveConfigJson) ? result.liveConfigJson : null) ??
      snapshotEntry?.configJson ??
      null;

    if (!ruleType || !configJson) {
      logWarn(
        "Skipping validation retry because rule config was not found",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
        },
      );
      continue;
    }

    if (!providerRegistry.has(result.service)) {
      logWarn(
        "Skipping validation retry because provider is not registered",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
        },
      );
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "PROVIDER_NOT_REGISTERED",
            errorMessage: `Validation provider not registered: ${result.service}`,
          })
          .where(eq(externalServiceValidationResult.id, result.id));
      } catch (error) {
        logError(
          "Failed to mark validation result as FAILED for unregistered provider",
          "forms-responses",
          {
            error,
            resultId: result.id,
            responseId: result.responseId,
            ruleId: result.ruleId,
            service: result.service,
            formId: result.formId,
          },
        );
      }
      continue;
    }

    try {
      const jobData = genericValidationJobDataSchema.parse({
        responseId: result.responseId,
        ruleId: result.ruleId,
        referencedBlockId: result.referencedBlockId,
        snapshotProviderName: result.service,
        snapshotRuleType: ruleType,
        snapshotConfigJson: configJson,
        snapshotVersion: result.snapshotVersion ?? undefined,
      });
      preparedJobs.push({
        result,
        jobData,
        jobId: `validation-retry:${result.id}:${randomUUID()}`,
      });
    } catch (error) {
      logError("Failed to prepare validation retry job", "forms-responses", {
        error,
        resultId: result.id,
        responseId: result.responseId,
        ruleId: result.ruleId,
        service: result.service,
        formId: result.formId,
      });
      // enqueue に失敗した場合のみ FAILED に設定
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "ENQUEUE_FAILED",
            errorMessage: "Failed to prepare retry job",
          })
          .where(eq(externalServiceValidationResult.id, result.id));
      } catch (error) {
        logError(
          "Failed to mark validation result as FAILED after enqueue error",
          "forms-responses",
          {
            error,
            resultId: result.id,
            responseId: result.responseId,
            ruleId: result.ruleId,
            service: result.service,
            formId: result.formId,
          },
        );
      }
    }
  }

  for (const { result, jobData, jobId } of preparedJobs) {
    const claimed = await claimValidationRetryPending(result.id, jobId);
    if (!claimed) {
      logWarn(
        "Skipping validation retry because result was claimed concurrently",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
          jobId,
        },
      );
      continue;
    }

    const queue = getValidationQueue(result.service);

    let job: { id?: string };
    try {
      job = await queue.add(`validate-${result.service}`, jobData, {
        jobId,
      });
    } catch (error) {
      logError("Failed to enqueue validation retry job", "forms-responses", {
        error,
        resultId: result.id,
        responseId: result.responseId,
        ruleId: result.ruleId,
        service: result.service,
        formId: result.formId,
        jobId,
      });
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "ENQUEUE_FAILED",
            errorMessage: "Failed to enqueue retry job",
          })
          .where(
            and(
              eq(externalServiceValidationResult.id, result.id),
              eq(externalServiceValidationResult.jobId, jobId),
            ),
          );
      } catch (error) {
        logError(
          "Failed to mark validation result as FAILED after enqueue error",
          "forms-responses",
          {
            error,
            resultId: result.id,
            responseId: result.responseId,
            ruleId: result.ruleId,
            service: result.service,
            formId: result.formId,
            jobId,
          },
        );
      }
      continue;
    }

    if (job.id) {
      jobIds.push(job.id);
    }
    enqueuedCount++;
  }

  return {
    jobIds,
    enqueuedCount,
    skippedCount: results.length - enqueuedCount,
  };
}

async function claimValidationRetryPending(
  resultId: string,
  jobId: string,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + VALIDATION_RETRY_CLAIM_LEASE_MS);
  const updateResult = await db
    .update(externalServiceValidationResult)
    .set({
      status: "PENDING",
      lastAttemptAt: null,
      nextRetryAt: leaseUntil,
      errorCode: null,
      errorMessage: null,
      jobId,
    })
    .where(
      and(
        eq(externalServiceValidationResult.id, resultId),
        validationRetryClaimableCondition(now),
      ),
    );
  return (updateResult[0]?.affectedRows ?? 0) > 0;
}

async function discardQueuedValidationJob(params: {
  service: string | null;
  jobId: string | null;
  validationResultId: string;
}): Promise<void> {
  const { service, jobId, validationResultId } = params;
  if (!service || !jobId || !isValidServiceName(service)) return;

  try {
    const queue = getValidationQueue(service);
    const job = await queue.getJob(jobId);
    if (!job) return;

    await job.discard();
    const state = await job.getState();
    if (state === "waiting" || state === "delayed") {
      try {
        await job.remove();
      } catch (error) {
        logWarn(
          "Failed to remove queued validation job during cancellation",
          "forms-responses",
          {
            error,
            service,
            jobId,
            validationResultId,
            state,
          },
        );
      }
    }
  } catch (error) {
    logWarn(
      "Failed to discard queued validation job during cancellation",
      "forms-responses",
      {
        error,
        service,
        jobId,
        validationResultId,
      },
    );
  }
}

export const formsResponsesRouter = createHonoApp()
  .use("/:id/responses*", withDualFormAuth("EDITOR"))
  .get(
    "/:id/responses",
    zValidator("query", listResponsesQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const sortField = query.sort ?? "submittedAt";
      const sortOrder = query.order ?? "desc";
      const offset = (query.page - 1) * query.limit;
      const keyword = query.keyword?.trim();
      const whereCondition = (() => {
        if (!keyword) return eq(formResponse.formId, formId);

        const keywordPattern = buildPrefixSearchPattern(keyword);
        const countryCodePattern = buildPrefixSearchPattern(
          keyword.toUpperCase(),
        );
        return and(
          eq(formResponse.formId, formId),
          or(
            sql`${formResponse.id} like ${keywordPattern} escape ${LIKE_ESCAPE_CHAR}`,
            sql`${formResponse.respondentUuid} like ${keywordPattern} escape ${LIKE_ESCAPE_CHAR}`,
            sql`${formResponse.countryCode} like ${countryCodePattern} escape ${LIKE_ESCAPE_CHAR}`,
          ),
        );
      })();

      const rows = await db
        .select({
          id: formResponse.id,
          formId: formResponse.formId,
          submittedAt: formResponse.submittedAt,
          updatedAt: formResponse.updatedAt,
          respondentUuid: formResponse.respondentUuid,
          userAgent: formResponse.userAgent,
          sessionId: formResponse.sessionId,
          countryCode: formResponse.countryCode,
        })
        .from(formResponse)
        .where(whereCondition)
        .orderBy(
          sortOrder === "asc"
            ? sortField === "updatedAt"
              ? sql`${formResponse.updatedAt} asc`
              : sql`${formResponse.submittedAt} asc`
            : sortField === "updatedAt"
              ? sql`${formResponse.updatedAt} desc`
              : sql`${formResponse.submittedAt} desc`,
        )
        .offset(offset)
        .limit(query.limit + 1);
      const responses = rows.slice(0, query.limit);

      return c.json(
        ResponsesListResponseSchema.parse({
          responses,
          page: query.page,
          limit: query.limit,
          hasNext: rows.length > query.limit,
        }),
      );
    },
  )
  .post(
    "/:id/responses",
    withDualFormAuth("EDITOR"),
    responseBodySizeLimit,
    zValidator("json", createResponseSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");

      // Validate answers against plateContent-derived question definitions
      const [targetForm] = await db
        .select({ plateContent: form.plateContent })
        .from(form)
        .where(eq(form.id, formId))
        .limit(1);
      if (!targetForm) return c.json(errorResponse("Form not found"), 404);

      // All forms should have plateContent; log a warning if missing so we can
      // investigate. Validation still runs but without question-level checks.
      if (!targetForm.plateContent) {
        logWarn("POST: form missing plateContent", "forms-responses", {
          formId,
        });
      }
      const questions = targetForm.plateContent
        ? buildQuestionsFromPlateContent(targetForm.plateContent)
        : [];
      const validation = validateResponseData(payload.responses, {
        version: 1,
        settings: {},
        questions,
      });
      if (!validation.isValid) {
        return c.json(
          InvalidResponseDataErrorResponseSchema.parse({
            error: "Invalid response data",
            details: validation.errors,
          }),
          400,
        );
      }

      const responseDataJson = stringifyResponseDataJson(payload.responses);
      if (!responseDataJson) {
        return c.json(errorResponse("Response payload is too large"), 400);
      }

      const id = randomUUID();
      await db.insert(formResponse).values({
        id,
        formId,
        responseDataJson,
        respondentUuid: payload.respondentUuid ?? randomUUID(),
        userAgent: payload.userAgent,
        sessionId: payload.sessionId,
        countryCode: payload.countryCode,
      });

      const [created] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, id))
        .limit(1);

      return c.json(
        ResponseMutationResponseSchema.parse({ response: created ?? null }),
        201,
      );
    },
  )
  .get(
    "/:id/responses/ids",
    zValidator("query", limitedListQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const rows = await db
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(eq(formResponse.formId, formId))
        .orderBy(desc(formResponse.submittedAt), desc(formResponse.id))
        .offset(offset)
        .limit(pageSize + 1);
      const responseIds = rows.slice(0, pageSize).map((row) => row.id);
      return c.json(
        ResponseIdsResponseSchema.parse({
          responseIds,
          pagination: {
            page,
            pageSize,
            hasNext: rows.length > pageSize,
          },
        }),
      );
    },
  )
  .get("/:id/responses/:responseId", async (c) => {
    const formId = c.req.param("id");
    const responseId = c.req.param("responseId");
    const [response] = await db
      .select()
      .from(formResponse)
      .where(
        and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
      )
      .limit(1);
    if (!response) return c.json(errorResponse("Response not found"), 404);

    const externalValidations = await getExternalValidationResults(responseId);
    return c.json(
      ResponseDetailResponseSchema.parse({ response, externalValidations }),
    );
  })
  .put(
    "/:id/responses/:responseId",
    withDualFormAuth("EDITOR"),
    responseBodySizeLimit,
    zValidator("json", updateResponseSchema),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const payload = c.req.valid("json");

      // Single query: fetch both the existing response and the form's plateContent
      const [existing] = await db
        .select({
          id: formResponse.id,
          plateContent: form.plateContent,
        })
        .from(formResponse)
        .innerJoin(form, eq(form.id, formResponse.formId))
        .where(
          and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
        )
        .limit(1);
      if (!existing) return c.json(errorResponse("Response not found"), 404);

      // Validate answers against plateContent-derived question definitions
      if (!existing.plateContent) {
        logWarn("PUT: form missing plateContent", "forms-responses", {
          formId,
        });
      }
      const questions = existing.plateContent
        ? buildQuestionsFromPlateContent(existing.plateContent)
        : [];
      const validation = validateResponseData(payload.responses, {
        version: 1,
        settings: {},
        questions,
      });
      if (!validation.isValid) {
        return c.json(
          InvalidResponseDataErrorResponseSchema.parse({
            error: "Invalid response data",
            details: validation.errors,
          }),
          400,
        );
      }

      const responseDataJson = stringifyResponseDataJson(payload.responses);
      if (!responseDataJson) {
        return c.json(errorResponse("Response payload is too large"), 400);
      }

      await db
        .update(formResponse)
        .set({
          responseDataJson,
          updatedAt: new Date(),
        })
        .where(eq(formResponse.id, responseId));

      const [updated] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, responseId))
        .limit(1);

      return c.json(
        ResponseMutationResponseSchema.parse({ response: updated ?? null }),
      );
    },
  )
  .delete(
    "/:id/responses/:responseId",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const [target] = await db
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(
          and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
        )
        .limit(1);
      if (!target) return c.json(errorResponse("Response not found"), 404);

      await db.transaction(async (tx) => {
        await tx
          .delete(fingerprintDetail)
          .where(eq(fingerprintDetail.responseId, responseId));
        await tx
          .delete(externalServiceValidationResult)
          .where(eq(externalServiceValidationResult.responseId, responseId));
        await tx.delete(formResponse).where(eq(formResponse.id, responseId));
      });
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  )
  .post(
    "/:id/responses/bulk-delete",
    withDualFormAuth("EDITOR"),
    createRateLimit({ windowMs: 60_000, maxRequests: 10 }),
    zValidator("json", bulkDeleteSchema),
    async (c) => {
      const formId = c.req.param("id");
      const { responseIds: rawIds } = c.req.valid("json");
      const responseIds = [...new Set(rawIds)];

      const existingResponses = await db
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(
          and(
            eq(formResponse.formId, formId),
            inArray(formResponse.id, responseIds),
          ),
        );

      const existingIds = new Set(existingResponses.map((r) => r.id));
      const results: Array<{
        responseId: string;
        status: "deleted" | "failed";
        error?: string;
      }> = [];
      let deletedCount = 0;
      let failedCount = 0;

      for (const responseId of responseIds) {
        if (!existingIds.has(responseId)) {
          results.push({
            responseId,
            status: "failed",
            error: "Response not found or does not belong to this form",
          });
          failedCount++;
        }
      }

      const idsToDelete = responseIds.filter((id) => existingIds.has(id));

      if (idsToDelete.length > 0) {
        try {
          await db.transaction(async (tx) => {
            await tx
              .delete(fingerprintDetail)
              .where(inArray(fingerprintDetail.responseId, idsToDelete));
            await tx
              .delete(externalServiceValidationResult)
              .where(
                inArray(
                  externalServiceValidationResult.responseId,
                  idsToDelete,
                ),
              );
            await tx
              .delete(formResponse)
              .where(inArray(formResponse.id, idsToDelete));
          });

          for (const id of idsToDelete) {
            results.push({ responseId: id, status: "deleted" });
            deletedCount++;
          }
        } catch {
          for (const id of idsToDelete) {
            results.push({
              responseId: id,
              status: "failed",
              error: "Transaction failed",
            });
            failedCount++;
          }
        }
      }

      return c.json(
        BulkDeleteResponseSchema.parse({
          success: failedCount === 0,
          data: { deleted: deletedCount, failed: failedCount, results },
        }),
      );
    },
  )
  .post(
    "/:id/responses/validation/bulk-retry",
    withDualFormAuth("EDITOR"),
    zValidator("json", bulkRetrySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { validationResultIds } = c.req.valid("json");

      const targets = await db
        .select({
          id: externalServiceValidationResult.id,
          responseId: externalServiceValidationResult.responseId,
          ruleId: externalServiceValidationResult.ruleId,
          referencedBlockId: externalServiceValidationResult.referencedBlockId,
          service: externalServiceValidationResult.service,
          status: externalServiceValidationResult.status,
          snapshotVersion: externalServiceValidationResult.snapshotVersion,
          formId: formResponse.formId,
          liveRuleType: formValidationRule.ruleType,
          liveConfigJson: formValidationRule.configJson,
        })
        .from(externalServiceValidationResult)
        .innerJoin(
          formResponse,
          eq(formResponse.id, externalServiceValidationResult.responseId),
        )
        .leftJoin(
          formValidationRule,
          eq(formValidationRule.id, externalServiceValidationResult.ruleId),
        )
        .where(
          and(
            eq(formResponse.formId, formId),
            inArray(externalServiceValidationResult.id, validationResultIds),
            validationRetryClaimableCondition(new Date()),
          ),
        );

      if (targets.length === 0) {
        // ステータスフィルタなしで存在確認し、404 と 409 を区別する
        const [anyExisting] = await db
          .select({ id: externalServiceValidationResult.id })
          .from(externalServiceValidationResult)
          .innerJoin(
            formResponse,
            eq(formResponse.id, externalServiceValidationResult.responseId),
          )
          .where(
            and(
              eq(formResponse.formId, formId),
              inArray(externalServiceValidationResult.id, validationResultIds),
            ),
          )
          .limit(1);

        if (anyExisting) {
          return c.json(
            errorResponse(
              "Some or all matching validation results are already PENDING or PROCESSING",
            ),
            409,
          );
        }
        return c.json(
          errorResponse("No matching validation results found for this form"),
          404,
        );
      }

      // PENDING への claim は enqueueValidationRetries 内でレコードごとに行う
      const { jobIds, enqueuedCount, skippedCount } =
        await enqueueValidationRetries(targets);

      if (enqueuedCount === 0) {
        return c.json(
          ValidationRetryEnqueueErrorResponseSchema.parse({
            error:
              "No validation jobs could be enqueued; results may already be claimed or service configuration may be invalid",
            enqueued: 0,
            skipped: skippedCount,
            jobIds: [],
          }),
          422,
        );
      }

      return c.json(
        ValidationRetryResponseSchema.parse({
          enqueued: enqueuedCount,
          skipped: skippedCount,
          jobIds,
        }),
      );
    },
  )
  .post(
    "/:id/responses/:responseId/validation/retry",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");

      const rows = await db
        .select({
          id: externalServiceValidationResult.id,
          responseId: externalServiceValidationResult.responseId,
          ruleId: externalServiceValidationResult.ruleId,
          referencedBlockId: externalServiceValidationResult.referencedBlockId,
          service: externalServiceValidationResult.service,
          status: externalServiceValidationResult.status,
          snapshotVersion: externalServiceValidationResult.snapshotVersion,
          formId: formResponse.formId,
          liveRuleType: formValidationRule.ruleType,
          liveConfigJson: formValidationRule.configJson,
        })
        .from(externalServiceValidationResult)
        .innerJoin(
          formResponse,
          eq(formResponse.id, externalServiceValidationResult.responseId),
        )
        .leftJoin(
          formValidationRule,
          eq(formValidationRule.id, externalServiceValidationResult.ruleId),
        )
        .where(
          and(
            eq(formResponse.formId, formId),
            eq(formResponse.id, responseId),
            validationRetryClaimableCondition(new Date()),
          ),
        );
      if (rows.length === 0) {
        // ステータスフィルタなしで存在確認し、404 と 409 を区別する
        const [anyExisting] = await db
          .select({ id: externalServiceValidationResult.id })
          .from(externalServiceValidationResult)
          .innerJoin(
            formResponse,
            eq(formResponse.id, externalServiceValidationResult.responseId),
          )
          .where(
            and(
              eq(formResponse.formId, formId),
              eq(formResponse.id, responseId),
            ),
          )
          .limit(1);

        if (anyExisting) {
          return c.json(
            errorResponse(
              "Some or all matching validation results are already PENDING or PROCESSING",
            ),
            409,
          );
        }
        return c.json(errorResponse("Validation result not found"), 404);
      }

      // PENDING への claim は enqueueValidationRetries 内でレコードごとに行う
      const { jobIds, enqueuedCount, skippedCount } =
        await enqueueValidationRetries(rows);

      if (enqueuedCount === 0) {
        return c.json(
          ValidationRetryEnqueueErrorResponseSchema.parse({
            error:
              "No validation jobs could be enqueued; results may already be claimed or service configuration may be invalid",
            enqueued: 0,
            skipped: skippedCount,
            jobIds: [],
          }),
          422,
        );
      }

      return c.json(
        ValidationRetryResponseSchema.parse({
          enqueued: enqueuedCount,
          skipped: skippedCount,
          jobIds,
        }),
      );
    },
  )
  .post(
    "/:id/responses/:responseId/validation/:validationResultId/cancel",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const validationResultId = c.req.param("validationResultId");

      const [target] = await db
        .select({
          id: externalServiceValidationResult.id,
          service: externalServiceValidationResult.service,
          jobId: externalServiceValidationResult.jobId,
          status: externalServiceValidationResult.status,
        })
        .from(externalServiceValidationResult)
        .innerJoin(
          formResponse,
          eq(formResponse.id, externalServiceValidationResult.responseId),
        )
        .where(
          and(
            eq(formResponse.formId, formId),
            eq(formResponse.id, responseId),
            eq(externalServiceValidationResult.id, validationResultId),
          ),
        )
        .limit(1);

      if (!target) {
        return c.json(errorResponse("Validation result not found"), 404);
      }

      if (!cancellableValidationStatuses.has(target.status)) {
        return c.json(
          errorResponse(
            "Validation result cannot be cancelled in its current status",
          ),
          409,
        );
      }

      await discardQueuedValidationJob({
        service: target.service,
        jobId: target.jobId,
        validationResultId,
      });

      const updateResult = await db
        .update(externalServiceValidationResult)
        .set({
          status: "FAILED",
          nextRetryAt: null,
          errorCode: "CANCELLED_BY_USER",
          errorMessage: "Validation cancelled by user",
        })
        .where(
          and(
            eq(externalServiceValidationResult.id, validationResultId),
            cancellableValidationStatusCondition(),
          ),
        );

      if ((updateResult[0]?.affectedRows ?? 0) === 0) {
        const [current] = await db
          .select({
            id: externalServiceValidationResult.id,
            status: externalServiceValidationResult.status,
          })
          .from(externalServiceValidationResult)
          .innerJoin(
            formResponse,
            eq(formResponse.id, externalServiceValidationResult.responseId),
          )
          .where(
            and(
              eq(formResponse.formId, formId),
              eq(formResponse.id, responseId),
              eq(externalServiceValidationResult.id, validationResultId),
            ),
          )
          .limit(1);

        if (!current) {
          return c.json(errorResponse("Validation result not found"), 404);
        }

        return c.json(
          errorResponse(
            "Validation result cannot be cancelled in its current status",
          ),
          409,
        );
      }

      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  );
