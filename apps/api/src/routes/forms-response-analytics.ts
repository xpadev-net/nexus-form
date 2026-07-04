import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  form,
  formResponse,
} from "@nexus-form/database/schema";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import { and, count, desc, eq, lt, or, sql } from "drizzle-orm";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import { aggregateAllBlocksInBatches } from "../lib/forms/response-analytics";
import { createHonoApp } from "../lib/hono";
import { logError } from "../lib/logger";
import {
  BlockAnalyticsResponseSchema,
  ResponseAggregateResponseSchema,
  ResponseAnalyticsResponseSchema,
  ResponseStatusesResponseSchema,
} from "../types/domain/form-responses";

function extractDatabaseErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {};
  }

  const details: Record<string, unknown> = {};
  for (const key of ["code", "errno", "sqlState", "sqlMessage"] as const) {
    if (Object.hasOwn(error, key)) {
      details[key] = Reflect.get(error, key);
    }
  }
  return details;
}

export const formsResponseAnalyticsRouter = createHonoApp()
  .use("/:id/responses*", withDualFormAuth("EDITOR"))
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
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const responseDate =
        sql<string>`date_format(${formResponse.submittedAt}, '%Y-%m-%d')`.as(
          "date",
        );
      let rows: Array<{ date: string; count: number }>;
      try {
        rows = await db
          .select({
            date: responseDate,
            count: count(),
          })
          .from(formResponse)
          .where(eq(formResponse.formId, formId))
          .groupBy(responseDate)
          .orderBy(desc(responseDate))
          .offset(offset)
          .limit(pageSize + 1);
      } catch (error) {
        logError("Failed to load response analytics timeline", "database", {
          error,
          formId,
          page,
          pageSize,
          ...extractDatabaseErrorDetails(error),
        });
        throw error;
      }
      return c.json(
        ResponseAnalyticsResponseSchema.parse({
          timeline: rows.slice(0, pageSize),
          pagination: {
            page,
            pageSize,
            hasNext: rows.length > pageSize,
          },
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
  });
