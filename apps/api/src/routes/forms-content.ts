import { zValidator } from "@hono/zod-validator";
import { db, form } from "@nexus-form/database";
import { validatePlateContent } from "@nexus-form/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import { publishEditorEvent } from "../lib/redis-publisher";

const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5 MB in bytes

const updateContentSchema = z.object({
  plateContent: z
    .string()
    .refine(
      (s) => new TextEncoder().encode(s).byteLength <= MAX_CONTENT_BYTES,
      "Content exceeds 5 MB limit",
    ),
  expectedVersion: z.number().int().min(0),
});

export const formsContentRouter = createHonoApp()
  // GET /forms/:id/content — fetch plate document content
  .get("/:id/content", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    const [target] = await db
      .select({
        plateContent: form.plateContent,
        plateContentVersion: form.plateContentVersion,
      })
      .from(form)
      .where(eq(form.id, id))
      .limit(1);

    if (!target) return c.json({ error: "Form not found" }, 404);

    return c.json({
      plateContent: target.plateContent ?? "[]",
      plateContentVersion: target.plateContentVersion,
    });
  })

  // PUT /forms/:id/content — save plate document content with optimistic lock
  .put(
    "/:id/content",
    withDualFormAuth("EDITOR"),
    zValidator("json", updateContentSchema),
    async (c) => {
      const id = c.req.param("id");
      const { plateContent, expectedVersion } = c.req.valid("json");

      // Validate Plate JSON structure
      try {
        const parsed = JSON.parse(plateContent);
        if (!validatePlateContent(parsed)) {
          return c.json({ error: "Invalid Plate content structure" }, 400);
        }
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }

      // Optimistic lock: only update if version matches
      const result = await db
        .update(form)
        .set({
          plateContent,
          plateContentVersion: expectedVersion + 1,
        })
        .where(
          and(eq(form.id, id), eq(form.plateContentVersion, expectedVersion)),
        );

      if ((result[0]?.affectedRows ?? 0) === 0) {
        // Version mismatch — another user saved first
        const [current] = await db
          .select({
            plateContentVersion: form.plateContentVersion,
          })
          .from(form)
          .where(eq(form.id, id))
          .limit(1);

        if (!current) return c.json({ error: "Form not found" }, 404);

        return c.json(
          {
            error: "Version conflict",
            currentVersion: current.plateContentVersion,
          },
          409,
        );
      }

      // Publish SSE event for real-time sync (non-blocking — DB update already succeeded).
      // publishEditorEvent handles errors internally and logs them via logError,
      // so no additional .catch() is needed here.
      const authCtx = c.get("dualAuthContext");
      const userId = authCtx?.user_id ?? "unknown";
      void publishEditorEvent({
        type: "document_changed",
        formId: id,
        updatedBy: userId,
        version: expectedVersion + 1,
        timestamp: new Date().toISOString(),
      });

      return c.json({
        plateContentVersion: expectedVersion + 1,
      });
    },
  );
