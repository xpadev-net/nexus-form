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
import {
  FormDiffResponseSchema,
  PublishSnapshotResponseSchema,
  RestoreEditResponseSchema,
  SnapshotLatestResponseSchema,
  UnpublishedChangesInfoSchema,
} from "../types/domain/form-snapshot";

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
        plateContentVersion: restored.plateContentVersion,
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
    const response = UnpublishedChangesInfoSchema.parse(changes);
    return c.json(response);
  });
