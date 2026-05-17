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
import {
  extractQuestionsFromPlateContent,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  paginationMetadata,
  paginationQuerySchema,
} from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import { buildQuestionsFromPlateContent } from "../lib/forms/plate-question-builder";
import { aggregateAllBlocksInBatches } from "../lib/forms/response-analytics";
import { validateResponseData } from "../lib/forms/response-validator";
import { getLatestSnapshotByVersion } from "../lib/forms/snapshot-repository";
import { getExternalValidationResults } from "../lib/forms/validation-results";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { logWarn } from "../lib/logger";
import { getValidationQueue, isValidServiceName } from "../lib/queues";
import { createRateLimit } from "../lib/rate-limit";
import {
  BlockAnalyticsResponseSchema,
  BulkDeleteResponseSchema,
  ResponseAggregateResponseSchema,
  ResponseAnalyticsResponseSchema,
  ResponseDetailResponseSchema,
  ResponseIdsResponseSchema,
  ResponseMutationResponseSchema,
  ResponseStatusesResponseSchema,
  ResponsesListResponseSchema,
  ValidationRetryResponseSchema,
} from "../types/domain/form-responses";
import { OkResponseSchema } from "../types/domain/form-row";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const listResponsesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.enum(["submittedAt", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const limitedListQuerySchema = paginationQuerySchema;

const createResponseSchema = z.object({
  responses: z.array(responsePayloadItemSchema),
  respondentUuid: z.string().optional(),
  userAgent: z.string().optional(),
  sessionId: z.string().optional(),
  countryCode: z.string().max(10).optional(),
});

const updateResponseSchema = z.object({
  responses: z.array(responsePayloadItemSchema),
});

const bulkRetrySchema = z.object({
  validationResultIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100, "Cannot retry more than 100 validation results at once"),
});

const bulkDeleteSchema = z.object({
  responseIds: z
    .array(z.string().min(1))
    .min(1, "At least one response ID is required")
    .max(100, "Cannot delete more than 100 responses at once"),
});

/**
 * validation result 行に対して BullMQ ジョブを投入し、ステータスを PENDING にアトミックに更新する。
 * queue.add 成功後に per-row で PENDING + jobId を同時に設定することで、Worker がまだ
 * jobId 未設定の行を拾うレースを防ぐ。
 *
 * @returns enqueuedCount は BullMQ キューへの投入に成功した件数。
 *          DB 更新（PENDING 設定）に失敗した場合もジョブは既に投入済みのためカウントに含む。
 */
async function enqueueValidationRetries(
  results: Array<{
    id: string;
    responseId: string;
    ruleId: string;
    referencedBlockId: string;
    service: string | null;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MISSING";
    formId: string;
    liveRuleType: string | null;
    liveConfigJson: unknown;
  }>,
): Promise<{ jobIds: string[]; enqueuedCount: number; skippedCount: number }> {
  // MISSING は参照ブロック自体が存在しないため retry 不可。
  const retryable = results.filter((r) => r.status !== "MISSING");
  for (const r of results) {
    if (r.status === "MISSING") {
      console.warn(
        `Skipping retry for result ${r.id}: referenced block ${r.referencedBlockId} is missing`,
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
    const uniqueFormIds = [...new Set(needsFallback.map((r) => r.formId))];
    for (const fid of uniqueFormIds) {
      const snapshot = await getLatestSnapshotByVersion(fid);
      if (snapshot?.validationRulesJson) {
        for (const entry of parseValidationRuleSnapshot(
          snapshot.validationRulesJson,
        )) {
          snapshotRuleMap.set(entry.id, {
            ruleType: entry.ruleType,
            configJson: entry.configJson,
          });
        }
      }
    }
  }

  const jobIds: string[] = [];
  let enqueuedCount = 0;

  for (const result of validResults) {
    if (!isValidServiceName(result.service)) {
      console.warn(
        `Skipping retry for result ${result.id}: invalid service name "${result.service}"`,
      );
      continue;
    }

    const snapshotEntry = snapshotRuleMap.get(result.ruleId);
    const ruleType = result.liveRuleType ?? snapshotEntry?.ruleType ?? null;
    const configJson =
      (isRecord(result.liveConfigJson) ? result.liveConfigJson : null) ??
      snapshotEntry?.configJson ??
      null;

    if (!ruleType || !configJson) {
      console.warn(
        `Skipping retry for result ${result.id}: rule config not found for ruleId=${result.ruleId}`,
      );
      continue;
    }

    if (!providerRegistry.has(result.service)) {
      console.warn(
        `Skipping retry for result ${result.id}: provider "${result.service}" is not registered`,
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
      } catch {
        console.error(
          `Failed to mark result ${result.id} as FAILED for unregistered provider`,
        );
      }
      continue;
    }

    const queue = getValidationQueue(result.service);

    let job: { id?: string };
    try {
      job = await queue.add(
        `validate-${result.service}`,
        {
          responseId: result.responseId,
          ruleId: result.ruleId,
          referencedBlockId: result.referencedBlockId,
          snapshotProviderName: result.service,
          snapshotRuleType: ruleType,
          snapshotConfigJson: configJson,
        },
        { removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch {
      // enqueue に失敗した場合のみ FAILED に設定
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "ENQUEUE_FAILED",
            errorMessage: "Failed to enqueue retry job",
          })
          .where(eq(externalServiceValidationResult.id, result.id));
      } catch {
        console.error(
          `Failed to mark result ${result.id} as FAILED after enqueue error`,
        );
      }
      continue;
    }

    // PENDING + jobId をアトミックに設定
    try {
      await db
        .update(externalServiceValidationResult)
        .set({
          status: "PENDING",
          lastAttemptAt: null,
          nextRetryAt: new Date(),
          errorCode: null,
          errorMessage: null,
          jobId: job.id ?? null,
        })
        .where(eq(externalServiceValidationResult.id, result.id));
    } catch {
      // ジョブは既にキューに投入済み。Worker が実行時にステータスを修正するため、
      // ここではログ出力のみで残りのエントリの処理を継続する。
      // ジョブは実行中なので、呼び出し元がトラッキング・キャンセルできるよう記録する。
      console.error(`Failed to set PENDING status for result ${result.id}`);
      if (job.id) {
        jobIds.push(job.id);
      }
      enqueuedCount++;
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

      const [responses, totalResult] = await Promise.all([
        db
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
          .where(eq(formResponse.formId, formId))
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
          .limit(query.limit),
        db
          .select({ count: count() })
          .from(formResponse)
          .where(eq(formResponse.formId, formId)),
      ]);

      return c.json(
        ResponsesListResponseSchema.parse({
          responses,
          total: totalResult[0]?.count ?? 0,
          page: query.page,
          limit: query.limit,
        }),
      );
    },
  )
  .post(
    "/:id/responses",
    withDualFormAuth("EDITOR"),
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
      if (!targetForm) return c.json({ error: "Form not found" }, 404);

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
          { error: "Invalid response data", details: validation.errors },
          400,
        );
      }

      const id = randomUUID();
      await db.insert(formResponse).values({
        id,
        formId,
        responseDataJson: JSON.stringify(payload.responses),
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
      const [rows, totalResult] = await Promise.all([
        db
          .select({ id: formResponse.id })
          .from(formResponse)
          .where(eq(formResponse.formId, formId))
          .orderBy(desc(formResponse.submittedAt), desc(formResponse.id))
          .offset(offset)
          .limit(pageSize),
        db
          .select({ count: count() })
          .from(formResponse)
          .where(eq(formResponse.formId, formId)),
      ]);
      const total = totalResult[0]?.count ?? 0;
      return c.json(
        ResponseIdsResponseSchema.parse({
          responseIds: rows.map((row) => row.id),
          pagination: paginationMetadata(page, pageSize, total),
        }),
      );
    },
  )
  .get("/:id/responses/statuses", async (c) => {
    const formId = c.req.param("id");
    const rows = await db
      .select({
        status: externalServiceValidationResult.status,
        count: count(),
      })
      .from(externalServiceValidationResult)
      .innerJoin(
        formResponse,
        eq(formResponse.id, externalServiceValidationResult.responseId),
      )
      .where(eq(formResponse.formId, formId))
      .groupBy(externalServiceValidationResult.status);
    return c.json(ResponseStatusesResponseSchema.parse({ statuses: rows }));
  })
  .get("/:id/responses/aggregate", async (c) => {
    const formId = c.req.param("id");
    const [totalRows, uniqueRows] = await Promise.all([
      db
        .select({ count: count() })
        .from(formResponse)
        .where(eq(formResponse.formId, formId)),
      db
        .select({
          count: sql<number>`count(distinct ${formResponse.respondentUuid})`,
        })
        .from(formResponse)
        .where(eq(formResponse.formId, formId)),
    ]);
    return c.json(
      ResponseAggregateResponseSchema.parse({
        totalResponses: totalRows[0]?.count ?? 0,
        uniqueRespondents: uniqueRows[0]?.count ?? 0,
      }),
    );
  })
  .get(
    "/:id/responses/analytics",
    zValidator("query", limitedListQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const responseDate = sql<string>`date(${formResponse.submittedAt})`;
      const [timeline, totalResult] = await Promise.all([
        db
          .select({
            date: responseDate,
            count: count(),
          })
          .from(formResponse)
          .where(eq(formResponse.formId, formId))
          .groupBy(responseDate)
          .orderBy(sql`${responseDate} desc`)
          .offset(offset)
          .limit(pageSize),
        db
          .select({
            count: countDistinct(responseDate),
          })
          .from(formResponse)
          .where(eq(formResponse.formId, formId)),
      ]);
      const total = totalResult[0]?.count ?? 0;
      return c.json(
        ResponseAnalyticsResponseSchema.parse({
          timeline,
          pagination: paginationMetadata(page, pageSize, total),
        }),
      );
    },
  )
  .get("/:id/responses/block-analytics", async (c) => {
    const formId = c.req.param("id");

    const [formRecord] = await db
      .select({ plateContent: form.plateContent })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    let blocks: Array<{ blockId: string; type: string; content: unknown }> = [];
    if (formRecord?.plateContent) {
      try {
        const parsed: unknown = JSON.parse(formRecord.plateContent);
        if (Array.isArray(parsed)) {
          blocks = extractQuestionsFromPlateContent(parsed).map((q) => ({
            blockId: q.blockId,
            type: q.type,
            content: { title: q.title, validation: q.validation },
          }));
        }
      } catch {
        // plateContent が不正な場合は空配列のまま続行
      }
    }

    const analytics = await aggregateAllBlocksInBatches(
      formId,
      blocks,
      (cursor, limit) => {
        const cursorSubmittedAt = cursor
          ? cursor.submittedAt instanceof Date
            ? cursor.submittedAt
            : new Date(cursor.submittedAt)
          : undefined;

        return db
          .select({
            id: formResponse.id,
            submittedAt: formResponse.submittedAt,
            responseDataJson: formResponse.responseDataJson,
          })
          .from(formResponse)
          .where(
            and(
              eq(formResponse.formId, formId),
              cursor && cursorSubmittedAt
                ? or(
                    lt(formResponse.submittedAt, cursorSubmittedAt),
                    and(
                      eq(formResponse.submittedAt, cursorSubmittedAt),
                      lt(formResponse.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(formResponse.submittedAt), desc(formResponse.id))
          .limit(limit);
      },
    );
    return c.json(BlockAnalyticsResponseSchema.parse({ blocks: analytics }));
  })
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
    if (!response) return c.json({ error: "Response not found" }, 404);

    const externalValidations = await getExternalValidationResults(responseId);
    return c.json(
      ResponseDetailResponseSchema.parse({ response, externalValidations }),
    );
  })
  .put(
    "/:id/responses/:responseId",
    withDualFormAuth("EDITOR"),
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
      if (!existing) return c.json({ error: "Response not found" }, 404);

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
          { error: "Invalid response data", details: validation.errors },
          400,
        );
      }

      await db
        .update(formResponse)
        .set({
          responseDataJson: JSON.stringify(payload.responses),
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
      if (!target) return c.json({ error: "Response not found" }, 404);

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
            // PROCESSING/PENDING 中のレコードを除外し、既存ワーカーとの重複実行を防止する
            ne(externalServiceValidationResult.status, "PROCESSING"),
            ne(externalServiceValidationResult.status, "PENDING"),
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
            {
              error:
                "Some or all matching validation results are already PENDING or PROCESSING",
            },
            409,
          );
        }
        return c.json(
          { error: "No matching validation results found for this form" },
          404,
        );
      }

      // PENDING リセットは enqueueValidationRetries 内で per-row にアトミックに行う
      const { jobIds, enqueuedCount, skippedCount } =
        await enqueueValidationRetries(targets);

      if (enqueuedCount === 0) {
        return c.json(
          {
            error:
              "No validation jobs could be enqueued; check service configuration",
            enqueued: 0,
            skipped: skippedCount,
            jobIds: [],
          },
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
            // PROCESSING/PENDING 中のレコードを除外し、既存ワーカーとの重複実行を防止する
            ne(externalServiceValidationResult.status, "PROCESSING"),
            ne(externalServiceValidationResult.status, "PENDING"),
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
            {
              error:
                "Some or all matching validation results are already PENDING or PROCESSING",
            },
            409,
          );
        }
        return c.json({ error: "Validation result not found" }, 404);
      }

      // PENDING リセットは enqueueValidationRetries 内で per-row にアトミックに行う
      const { jobIds, enqueuedCount, skippedCount } =
        await enqueueValidationRetries(rows);

      if (enqueuedCount === 0) {
        return c.json(
          {
            error:
              "No validation jobs could be enqueued; check service configuration",
            enqueued: 0,
            skipped: skippedCount,
            jobIds: [],
          },
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
            eq(externalServiceValidationResult.id, validationResultId),
          ),
        )
        .limit(1);

      if (!target) return c.json({ error: "Validation result not found" }, 404);

      await db
        .update(externalServiceValidationResult)
        .set({
          status: "FAILED",
          nextRetryAt: null,
          errorCode: "CANCELLED_BY_USER",
          errorMessage: "Validation cancelled by user",
        })
        .where(eq(externalServiceValidationResult.id, validationResultId));

      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  );
