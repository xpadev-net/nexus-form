import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { fingerprintDetail, formResponse } from "@nexus-form/database/schema";
import { and, eq, inArray, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  checkFormAccess,
  hasEditPermission,
  withDualAuth,
} from "../lib/dual-auth";
import { getFingerprintAnonymizer } from "../lib/fingerprint/anonymizer";
import { getDataRetentionManager } from "../lib/fingerprint/data-retention";
import { createHonoApp } from "../lib/hono";
import { errorResponse } from "../types/domain/common";
import {
  AnonymizedFingerprintsResponseSchema,
  FingerprintDeleteResponseSchema,
  FingerprintGetResponseSchema,
  FingerprintManageResponseSchema,
  FingerprintSaveResponseSchema,
  RetentionCleanupResponseSchema,
  RetentionConfigErrorResponseSchema,
  RetentionGetResponseSchema,
  RetentionUpdateResponseSchema,
} from "../types/domain/fingerprint";

const saveFingerprintSchema = z.object({
  responseId: z.string().min(1),
  fingerprintType: z.string().min(1).max(50),
  components: z
    .array(
      z.object({
        componentName: z.string().min(1).max(255),
        componentValue: z.string().min(1),
        componentValueHash: z.string().min(1).max(255),
        confidence: z.number().min(0).max(1).optional(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .min(1),
});

const getFingerprintQuerySchema = z.object({
  responseId: z.string().optional(),
  formId: z.string().optional(),
});

const anonymizedQuerySchema = z.object({
  responseId: z.string().optional(),
  formId: z.string().optional(),
  includeStats: z.coerce.boolean().optional(),
});

const deleteManageSchema = z.object({
  responseId: z.string().optional(),
  formId: z.string().optional(),
  before: z.string().datetime().optional(),
});

const retentionConfigSchema = z.object({
  fingerprintDetailRetentionDays: z.number().int().min(1).max(365).optional(),
  responseRetentionDays: z.number().int().min(1).max(3650).optional(),
  autoCleanupEnabled: z.boolean().optional(),
  cleanupSchedule: z.string().optional(),
});

async function getResponseFormId(responseId: string): Promise<string | null> {
  const [resp] = await db
    .select({ formId: formResponse.formId })
    .from(formResponse)
    .where(eq(formResponse.id, responseId))
    .limit(1);
  return resp?.formId ?? null;
}

async function responseBelongsToForm(
  responseId: string,
  formId: string,
): Promise<boolean> {
  return (await getResponseFormId(responseId)) === formId;
}

export const fingerprintRouter = createHonoApp()
  .post(
    "/save",
    withDualAuth(),
    zValidator("json", saveFingerprintSchema),
    async (c) => {
      const payload = c.req.valid("json");
      const context = c.get("dualAuthContext");
      if (!context) return c.json(errorResponse("Unauthorized"), 401);

      const [response] = await db
        .select({ id: formResponse.id, formId: formResponse.formId })
        .from(formResponse)
        .where(eq(formResponse.id, payload.responseId))
        .limit(1);
      if (!response) return c.json(errorResponse("Response not found"), 404);

      const hasAccess = await hasEditPermission(context, response.formId);
      if (!hasAccess) {
        return c.json(errorResponse("Access denied to this form"), 403);
      }

      await db.transaction(async (tx) => {
        for (const component of payload.components) {
          await tx
            .delete(fingerprintDetail)
            .where(
              and(
                eq(fingerprintDetail.responseId, payload.responseId),
                eq(fingerprintDetail.fingerprintType, payload.fingerprintType),
                eq(fingerprintDetail.componentName, component.componentName),
              ),
            );

          await tx.insert(fingerprintDetail).values({
            id: randomUUID(),
            responseId: payload.responseId,
            fingerprintType: payload.fingerprintType,
            componentName: component.componentName,
            componentValue: component.componentValue,
            componentValueHash: component.componentValueHash,
            confidence: component.confidence,
            expiresAt: component.expiresAt
              ? new Date(component.expiresAt)
              : null,
          });
        }
      });

      return c.json(
        FingerprintSaveResponseSchema.parse({
          saved: payload.components.length,
        }),
      );
    },
  )
  .get(
    "/get",
    withDualAuth(),
    zValidator("query", getFingerprintQuerySchema),
    async (c) => {
      const { responseId, formId } = c.req.valid("query");
      const context = c.get("dualAuthContext");
      if (!context) return c.json(errorResponse("Unauthorized"), 401);

      let fingerprintWhere: SQL;
      // フォームアクセス権チェック
      if (formId) {
        const hasAccess = await checkFormAccess(context, formId);
        if (!hasAccess) {
          return c.json(errorResponse("Access denied to this form"), 403);
        }
        if (responseId && !(await responseBelongsToForm(responseId, formId))) {
          return c.json(errorResponse("Response not found"), 404);
        }
        if (responseId) {
          fingerprintWhere = eq(fingerprintDetail.responseId, responseId);
        } else {
          fingerprintWhere = eq(formResponse.formId, formId);
        }
      } else if (responseId) {
        const responseFormId = await getResponseFormId(responseId);
        if (!responseFormId) {
          return c.json(errorResponse("Response not found"), 404);
        }
        const hasAccess = await checkFormAccess(context, responseFormId);
        if (!hasAccess) {
          return c.json(errorResponse("Access denied to this form"), 403);
        }
        fingerprintWhere = eq(fingerprintDetail.responseId, responseId);
      } else {
        return c.json(errorResponse("responseId or formId is required"), 400);
      }

      const rows = await db
        .select({
          id: fingerprintDetail.id,
          responseId: fingerprintDetail.responseId,
          fingerprintType: fingerprintDetail.fingerprintType,
          componentName: fingerprintDetail.componentName,
          componentValueHash: fingerprintDetail.componentValueHash,
          confidence: fingerprintDetail.confidence,
          collectedAt: fingerprintDetail.collectedAt,
        })
        .from(fingerprintDetail)
        .innerJoin(
          formResponse,
          eq(formResponse.id, fingerprintDetail.responseId),
        )
        .where(fingerprintWhere);

      return c.json(FingerprintGetResponseSchema.parse({ fingerprints: rows }));
    },
  )
  .get(
    "/anonymized",
    withDualAuth(),
    zValidator("query", anonymizedQuerySchema),
    async (c) => {
      const { responseId, formId, includeStats } = c.req.valid("query");
      const context = c.get("dualAuthContext");
      if (!context) return c.json(errorResponse("Unauthorized"), 401);
      if (!responseId && !formId) {
        return c.json(errorResponse("responseId or formId is required"), 400);
      }

      // フォームアクセス権チェック
      if (formId) {
        const hasAccess = await checkFormAccess(context, formId);
        if (!hasAccess) {
          return c.json(errorResponse("Access denied to this form"), 403);
        }
        if (responseId && !(await responseBelongsToForm(responseId, formId))) {
          return c.json(errorResponse("Response not found"), 404);
        }
      } else if (responseId) {
        const responseFormId = await getResponseFormId(responseId);
        if (!responseFormId) {
          return c.json(errorResponse("Response not found"), 404);
        }
        const hasAccess = await checkFormAccess(context, responseFormId);
        if (!hasAccess) {
          return c.json(errorResponse("Access denied to this form"), 403);
        }
      }

      const anonymizer = getFingerprintAnonymizer();
      const result = await anonymizer.getAnonymizedFingerprints(
        responseId,
        formId,
        includeStats ?? false,
      );

      return c.json(AnonymizedFingerprintsResponseSchema.parse(result));
    },
  )
  .get("/manage", withDualAuth(["admin"]), async (c) => {
    const rows = await db
      .select({
        id: fingerprintDetail.id,
        responseId: fingerprintDetail.responseId,
        fingerprintType: fingerprintDetail.fingerprintType,
        componentName: fingerprintDetail.componentName,
        componentValueHash: fingerprintDetail.componentValueHash,
        collectedAt: fingerprintDetail.collectedAt,
        expiresAt: fingerprintDetail.expiresAt,
      })
      .from(fingerprintDetail);

    return c.json(
      FingerprintManageResponseSchema.parse({
        fingerprints: rows,
        total: rows.length,
      }),
    );
  })
  .delete(
    "/manage",
    withDualAuth(["admin"]),
    zValidator("json", deleteManageSchema),
    async (c) => {
      const { responseId, formId, before } = c.req.valid("json");

      if (!responseId && !formId && !before) {
        return c.json(errorResponse("At least one filter is required"), 400);
      }

      const responseIds = formId
        ? (
            await db
              .select({ id: formResponse.id })
              .from(formResponse)
              .where(eq(formResponse.formId, formId))
          ).map((row) => row.id)
        : [];

      if (formId && responseIds.length === 0) {
        return c.json(FingerprintDeleteResponseSchema.parse({ deleted: 0 }));
      }

      const deleted = await db
        .delete(fingerprintDetail)
        .where(
          and(
            responseId
              ? eq(fingerprintDetail.responseId, responseId)
              : undefined,
            formId
              ? inArray(fingerprintDetail.responseId, responseIds)
              : undefined,
            before
              ? lt(fingerprintDetail.collectedAt, new Date(before))
              : undefined,
          ),
        );

      return c.json(
        FingerprintDeleteResponseSchema.parse({
          deleted: deleted[0]?.affectedRows ?? 0,
        }),
      );
    },
  )
  .get("/retention", withDualAuth(["admin"]), async (c) => {
    const manager = getDataRetentionManager();
    const [config, stats] = await Promise.all([
      manager.getConfig(),
      manager.getDataRetentionStats(),
    ]);
    return c.json(RetentionGetResponseSchema.parse({ config, stats }));
  })
  .post(
    "/retention",
    withDualAuth(["admin"]),
    zValidator("json", retentionConfigSchema),
    async (c) => {
      const manager = getDataRetentionManager();
      const config = c.req.valid("json");
      const validation = manager.validateConfig(config);
      if (!validation.valid) {
        return c.json(
          RetentionConfigErrorResponseSchema.parse({
            error: "Invalid config",
            details: validation.errors,
          }),
          400,
        );
      }

      manager.updateConfig(config);
      return c.json(
        RetentionUpdateResponseSchema.parse({ config: manager.getConfig() }),
      );
    },
  )
  .put("/retention", withDualAuth(["admin"]), async (c) => {
    const manager = getDataRetentionManager();
    const result = await manager.cleanupExpiredData();
    return c.json(RetentionCleanupResponseSchema.parse({ result }));
  });
