import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  NoChangesError,
  SnapshotNotFoundError,
} from "../lib/errors/form-errors";
import {
  calculateFormDiff,
  checkUnpublishedChanges,
  getLatestSnapshot,
  getLatestSnapshotByVersion,
  publishSnapshot,
  restoreFromSnapshot,
} from "../lib/forms/snapshot-repository";
import { createHonoApp } from "../lib/hono";
import { RestoreEditResponseSchema } from "../types/domain/form-snapshot";
import { isoDate } from "../types/domain/iso-date";

const SnapshotListItemResponseSchema = z.object({
  id: z.string(),
  formId: z.string(),
  version: z.number().int().min(1),
  isActive: z.boolean(),
  publishedBy: z.string(),
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

const PublishSnapshotResponseSchema = z.object({
  version: z.number().int().min(1),
  publishedAt: isoDate,
});
export type PublishSnapshotResponse = z.infer<
  typeof PublishSnapshotResponseSchema
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

  .post(
    "/:id/snapshots",
    withDualFormAuth("EDITOR"),
    zValidator("json", z.object({ changeLog: z.string().optional() })),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const { changeLog } = c.req.valid("json");
      try {
        const result = await publishSnapshot(formId, auth.user_id, {
          changeLog,
        });
        const response = PublishSnapshotResponseSchema.parse(result);
        return c.json(response);
      } catch (error) {
        if (error instanceof NoChangesError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  )

  .post("/:id/snapshots/reset", withDualFormAuth("EDITOR"), async (c) => {
    const formId = c.req.param("id");
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    try {
      const restored = await restoreFromSnapshot(formId);
      const response = RestoreEditResponseSchema.parse({
        ok: true,
        plateContent: restored.plateContent,
      });
      return c.json(response);
    } catch (error) {
      if (error instanceof SnapshotNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  })

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
