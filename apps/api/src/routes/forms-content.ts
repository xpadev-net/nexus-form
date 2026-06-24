import { zValidator } from "@hono/zod-validator";
import { db, form } from "@nexus-form/database";
import { validatePlateContent } from "@nexus-form/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  CompletionTargetValidationErrorResponseSchema,
  validateCompletionTargetsForApi,
} from "../lib/forms/completion-target-validation";
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

export const FormContentResponseSchema = z.object({
  plateContent: z.string(),
  plateContentVersion: z.number().int().min(0),
});
export type FormContentResponse = z.infer<typeof FormContentResponseSchema>;

export const FormContentSaveResponseSchema = z.object({
  plateContentVersion: z.number().int().min(0),
});
export type FormContentSaveResponse = z.infer<
  typeof FormContentSaveResponseSchema
>;

export const FormContentConflictResponseSchema = z.object({
  error: z.literal("Version conflict"),
  currentVersion: z.number().int().min(0),
});
export type FormContentConflictResponse = z.infer<
  typeof FormContentConflictResponseSchema
>;

export const FormContentNotFoundResponseSchema = z.object({
  error: z.literal("Form not found"),
});
export type FormContentNotFoundResponse = z.infer<
  typeof FormContentNotFoundResponseSchema
>;

export const FormContentInvalidPlateResponseSchema = z.object({
  error: z.literal("Invalid Plate content structure"),
});
export type FormContentInvalidPlateResponse = z.infer<
  typeof FormContentInvalidPlateResponseSchema
>;

export const FormContentInvalidJsonResponseSchema = z.object({
  error: z.literal("Invalid JSON"),
});
export type FormContentInvalidJsonResponse = z.infer<
  typeof FormContentInvalidJsonResponseSchema
>;

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

    if (!target) {
      return c.json(
        FormContentNotFoundResponseSchema.parse({
          error: "Form not found",
        }),
        404,
      );
    }

    return c.json(
      FormContentResponseSchema.parse({
        plateContent: target.plateContent ?? "[]",
        plateContentVersion: target.plateContentVersion,
      }),
    );
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(plateContent);
      } catch {
        return c.json(
          FormContentInvalidJsonResponseSchema.parse({
            error: "Invalid JSON",
          }),
          400,
        );
      }
      if (!validatePlateContent(parsed)) {
        return c.json(
          FormContentInvalidPlateResponseSchema.parse({
            error: "Invalid Plate content structure",
          }),
          400,
        );
      }
      const completionTargetError = validateCompletionTargetsForApi(parsed);
      if (completionTargetError) {
        return c.json(
          CompletionTargetValidationErrorResponseSchema.parse(
            completionTargetError,
          ),
          400,
        );
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

        if (!current) {
          return c.json(
            FormContentNotFoundResponseSchema.parse({
              error: "Form not found",
            }),
            404,
          );
        }

        return c.json(
          FormContentConflictResponseSchema.parse({
            error: "Version conflict",
            currentVersion: current.plateContentVersion,
          }),
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

      return c.json(
        FormContentSaveResponseSchema.parse({
          plateContentVersion: expectedVersion + 1,
        }),
      );
    },
  );
