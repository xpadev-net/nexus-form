import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { formSnapshot } from "@nexus-form/database/schema";
import { NO_CHANGES_TO_PUBLISH_CODE } from "@nexus-form/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  paginationMetadata,
  paginationQuerySchema,
} from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  FormValidationError,
  NoChangesError,
  SnapshotNotFoundError,
} from "../lib/errors/form-errors";
import {
  activateSnapshot,
  calculateFormDiff,
  checkUnpublishedChanges,
  getLatestSnapshot,
  getLatestSnapshotByVersion,
  publishSnapshot,
  restoreFromSnapshot,
  restoreFromSnapshotVersion,
} from "../lib/forms/snapshot-repository";
import { withFormStructureMutationLock } from "../lib/forms/structure-mutation-lock";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { resolveAuditUserId } from "../lib/resolve-audit-user-id";
import { ErrorResponseSchema, errorResponse } from "../types/domain/common";
import { RestoreEditResponseSchema } from "../types/domain/form-snapshot";
import { isoDate } from "../types/domain/iso-date";
import {
  formVersionDiffQuerySchema,
  routePaginationSchema,
} from "./form-route-schemas";

const SnapshotListItemResponseSchema = z.object({
  id: z.string(),
  formId: z.string(),
  version: z.number().int().min(1),
  isActive: z.boolean(),
  publishedBy: z.string().nullable(),
  publishedAt: isoDate,
  changeLog: z.string().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  parentVersion: z.number().int().nullish(),
});

const SnapshotLatestResponseSchema = z.object({
  snapshot: SnapshotListItemResponseSchema.nullable(),
  hasActiveSnapshot: z.boolean(),
  activeSnapshotVersion: z.number().int().nullable(),
});
export type SnapshotLatestResponse = z.infer<
  typeof SnapshotLatestResponseSchema
>;

const SnapshotListResponseSchema = z.object({
  snapshots: z.array(SnapshotListItemResponseSchema),
  pagination: routePaginationSchema,
});
export type SnapshotListResponse = z.infer<typeof SnapshotListResponseSchema>;

const SnapshotDiffResponseSchema = z.object({
  fromVersion: z.number().int().min(1),
  toVersion: z.number().int().min(1),
  changed: z.boolean(),
  fromPlateContent: z.string(),
  toPlateContent: z.string(),
});
export type SnapshotDiffResponse = z.infer<typeof SnapshotDiffResponseSchema>;

const SnapshotContentResponseSchema = z.object({
  plateContent: z.string(),
  version: z.number().int().min(1),
  publishedAt: isoDate,
});

const formsSnapshotsMutationRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyGenerator: (c) => {
    const auth = c.get("dualAuthContext");
    const subject =
      auth?.user_id !== undefined
        ? `user:${auth.user_id}`
        : `ip:${getClientIp(c)}`;
    return `rate_limit:forms-snapshots:${subject}:${c.req.path}`;
  },
});
export type SnapshotContentResponse = z.infer<
  typeof SnapshotContentResponseSchema
>;

const ActivateSnapshotResponseSchema = z.object({
  ok: z.literal(true),
  snapshot: SnapshotListItemResponseSchema.extend({
    plateContent: z.string(),
  }),
});
export type ActivateSnapshotResponse = z.infer<
  typeof ActivateSnapshotResponseSchema
>;

const PublishSnapshotResponseSchema = z.object({
  version: z.number().int().min(1),
  publishedAt: isoDate,
});
export type PublishSnapshotResponse = z.infer<
  typeof PublishSnapshotResponseSchema
>;

const PublishSnapshotValidationErrorResponseSchema = z.object({
  error: z.string(),
  details: z.object({
    blockIds: z.array(z.string()),
  }),
});
export type PublishSnapshotValidationErrorResponse = z.infer<
  typeof PublishSnapshotValidationErrorResponseSchema
>;

const NoChangesToPublishErrorResponseSchema = ErrorResponseSchema.extend({
  code: z.literal(NO_CHANGES_TO_PUBLISH_CODE),
});
export type NoChangesToPublishErrorResponse = z.infer<
  typeof NoChangesToPublishErrorResponseSchema
>;

const UnpublishedChangesInfoResponseSchema = z.object({
  hasChanges: z.boolean(),
  hasValidationRuleChanges: z.boolean(),
  lastPublishedAt: isoDate.nullable(),
});
export type UnpublishedChangesInfoResponse = z.infer<
  typeof UnpublishedChangesInfoResponseSchema
>;

const NodeDiffResponseSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string().nullable(),
  diffType: z.enum(["added", "removed", "modified"]),
});

const FormDiffResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    formId: z.string(),
    hasUnpublishedChanges: z.boolean(),
    hasChangesFromActive: z.boolean(),
    hasValidationRuleChanges: z.boolean(),
    nodes: z.array(NodeDiffResponseSchema),
    totalChanges: z.number().int(),
    lastChecked: isoDate,
  }),
});
export type FormDiffResponse = z.infer<typeof FormDiffResponseSchema>;

export const formsSnapshotsRouter = createHonoApp()
  .use("/:id/snapshots*", withDualFormAuth("VIEWER"))
  .use("/:id/diff", withDualFormAuth("VIEWER"))
  .use("/:id/unpublished-changes", withDualFormAuth("VIEWER"))

  .get("/:id/snapshots/latest", async (c) => {
    const formId = c.req.param("id");
    const [snapshot, activeSnapshot] = await Promise.all([
      getLatestSnapshotByVersion(formId),
      getLatestSnapshot(formId),
    ]);
    const response = SnapshotLatestResponseSchema.parse({
      snapshot: snapshot ?? null,
      hasActiveSnapshot: !!activeSnapshot,
      activeSnapshotVersion: activeSnapshot?.version ?? null,
    });
    return c.json(response);
  })

  .get(
    "/:id/snapshots",
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const [snapshots, totalResult] = await Promise.all([
        db
          .select({
            id: formSnapshot.id,
            formId: formSnapshot.formId,
            version: formSnapshot.version,
            isActive: formSnapshot.isActive,
            publishedBy: formSnapshot.publishedBy,
            publishedAt: formSnapshot.publishedAt,
            changeLog: formSnapshot.changeLog,
            title: formSnapshot.title,
            description: formSnapshot.description,
            parentVersion: formSnapshot.parentVersion,
          })
          .from(formSnapshot)
          .where(eq(formSnapshot.formId, formId))
          .orderBy(desc(formSnapshot.version))
          .offset(offset)
          .limit(pageSize),
        db
          .select({ count: count() })
          .from(formSnapshot)
          .where(eq(formSnapshot.formId, formId)),
      ]);
      const total = totalResult[0]?.count ?? 0;
      return c.json(
        SnapshotListResponseSchema.parse({
          snapshots,
          pagination: paginationMetadata(page, pageSize, total),
        }),
      );
    },
  )

  .get(
    "/:id/snapshots/diff",
    zValidator("query", formVersionDiffQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { fromVersion, toVersion } = c.req.valid("query");
      const [fromSnapshotRows, toSnapshotRows] = await Promise.all([
        db
          .select({
            plateContent: formSnapshot.plateContent,
            validationRulesJson: formSnapshot.validationRulesJson,
            structureJson: formSnapshot.structureJson,
            version: formSnapshot.version,
          })
          .from(formSnapshot)
          .where(
            and(
              eq(formSnapshot.formId, formId),
              eq(formSnapshot.version, fromVersion),
            ),
          )
          .limit(1),
        db
          .select({
            plateContent: formSnapshot.plateContent,
            validationRulesJson: formSnapshot.validationRulesJson,
            structureJson: formSnapshot.structureJson,
            version: formSnapshot.version,
          })
          .from(formSnapshot)
          .where(
            and(
              eq(formSnapshot.formId, formId),
              eq(formSnapshot.version, toVersion),
            ),
          )
          .limit(1),
      ]);

      const from = fromSnapshotRows[0];
      const to = toSnapshotRows[0];
      if (!from || !to) {
        return c.json(errorResponse("Snapshot not found"), 404);
      }

      return c.json(
        SnapshotDiffResponseSchema.parse({
          fromVersion,
          toVersion,
          changed:
            from.plateContent !== to.plateContent ||
            from.validationRulesJson !== to.validationRulesJson ||
            from.structureJson !== to.structureJson,
          fromPlateContent: from.plateContent,
          toPlateContent: to.plateContent,
        }),
      );
    },
  )

  .get("/:id/snapshots/:version/content", async (c) => {
    const formId = c.req.param("id");
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) {
      return c.json(errorResponse("Invalid version"), 400);
    }

    const [snapshot] = await db
      .select({
        plateContent: formSnapshot.plateContent,
        version: formSnapshot.version,
        publishedAt: formSnapshot.publishedAt,
      })
      .from(formSnapshot)
      .where(
        and(eq(formSnapshot.formId, formId), eq(formSnapshot.version, version)),
      )
      .limit(1);

    if (!snapshot) {
      return c.json(errorResponse("Snapshot not found"), 404);
    }

    return c.json(SnapshotContentResponseSchema.parse(snapshot));
  })

  .post(
    "/:id/snapshots/:version/activate",
    withDualFormAuth("EDITOR"),
    formsSnapshotsMutationRateLimit,
    async (c) => {
      const formId = c.req.param("id");
      const version = Number(c.req.param("version"));
      if (!Number.isInteger(version) || version < 1)
        return c.json(errorResponse("Invalid version"), 400);

      try {
        const updated = await activateSnapshot(formId, version);
        const response = ActivateSnapshotResponseSchema.parse({
          ok: true,
          snapshot: updated,
        });
        return c.json(response);
      } catch (error) {
        if (error instanceof SnapshotNotFoundError) {
          return c.json(errorResponse("Snapshot not found"), 404);
        }
        throw error;
      }
    },
  )

  .post(
    "/:id/snapshots",
    withDualFormAuth("EDITOR"),
    formsSnapshotsMutationRateLimit,
    zValidator("json", z.object({ changeLog: z.string().optional() })),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);
      const { changeLog } = c.req.valid("json");
      try {
        const result = await publishSnapshot(
          formId,
          resolveAuditUserId(auth.user_id),
          {
            changeLog,
          },
        );
        const response = PublishSnapshotResponseSchema.parse(result);
        return c.json(response);
      } catch (error) {
        if (error instanceof NoChangesError) {
          const response = NoChangesToPublishErrorResponseSchema.parse({
            ...errorResponse(error.message),
            code: NO_CHANGES_TO_PUBLISH_CODE,
          });
          return c.json(response, 400);
        }
        if (error instanceof FormValidationError) {
          const details =
            PublishSnapshotValidationErrorResponseSchema.shape.details.safeParse(
              error.details,
            );
          return c.json(
            PublishSnapshotValidationErrorResponseSchema.parse({
              error: error.message,
              details: details.success ? details.data : { blockIds: [] },
            }),
            400,
          );
        }
        throw error;
      }
    },
  )

  .post(
    "/:id/snapshots/:version/restore-edit",
    withDualFormAuth("EDITOR"),
    formsSnapshotsMutationRateLimit,
    async (c) => {
      const formId = c.req.param("id");
      const version = Number(c.req.param("version"));
      if (!Number.isInteger(version) || version < 1)
        return c.json(errorResponse("Invalid version"), 400);

      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);

      try {
        const restored = await withFormStructureMutationLock(formId, () =>
          restoreFromSnapshotVersion(formId, version),
        );
        const response = RestoreEditResponseSchema.parse({
          ok: true,
          plateContent: restored.plateContent,
        });
        return c.json(response);
      } catch (error) {
        if (error instanceof SnapshotNotFoundError) {
          return c.json(errorResponse("Snapshot not found"), 404);
        }
        throw error;
      }
    },
  )

  .post(
    "/:id/snapshots/reset",
    withDualFormAuth("EDITOR"),
    formsSnapshotsMutationRateLimit,
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);
      try {
        const restored = await restoreFromSnapshot(formId);
        const response = RestoreEditResponseSchema.parse({
          ok: true,
          plateContent: restored.plateContent,
        });
        return c.json(response);
      } catch (error) {
        if (error instanceof SnapshotNotFoundError) {
          return c.json(errorResponse(error.message), 404);
        }
        throw error;
      }
    },
  )

  .get("/:id/diff", async (c) => {
    const formId = c.req.param("id");
    const result = await calculateFormDiff(formId);
    const response = FormDiffResponseSchema.parse({
      success: true,
      data: result,
    });
    return c.json(response);
  })

  .get("/:id/unpublished-changes", async (c) => {
    const formId = c.req.param("id");
    const changes = await checkUnpublishedChanges(formId);
    const response = UnpublishedChangesInfoResponseSchema.parse(changes);
    return c.json(response);
  });
