import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  GoogleSheetsIntegrationSettingSchema,
  getFormIntegration,
  upsertFormIntegration,
} from "../lib/forms/form-integration-service";
import { createHonoApp } from "../lib/hono";
import { getSheetsSyncQueue } from "../lib/queues";

const FormIntegrationRecordSchema = z.object({
  id: z.string(),
  formId: z.string(),
  ownerUserId: z.string(),
  userId: z.string().nullable(),
  config: GoogleSheetsIntegrationSettingSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const FormIntegrationResponseSchema = z.object({
  integration: FormIntegrationRecordSchema.nullable(),
});
export type FormIntegrationResponse = z.infer<
  typeof FormIntegrationResponseSchema
>;

export const GoogleSheetsSyncUnsupportedResponseSchema = z.object({
  error: z.literal("Manual Google Sheets sync is not supported"),
  message: z.string(),
});
export type GoogleSheetsSyncUnsupportedResponse = z.infer<
  typeof GoogleSheetsSyncUnsupportedResponseSchema
>;

export const GoogleSheetsSyncJobResponseSchema = z.object({
  job: z.object({
    id: z.string().optional(),
    name: z.string(),
    state: z.string(),
    progress: z.unknown(),
    attemptsMade: z.number().int().min(0),
    failedReason: z.string().optional(),
    result: z.unknown(),
  }),
});
export type GoogleSheetsSyncJobResponse = z.infer<
  typeof GoogleSheetsSyncJobResponseSchema
>;

export const formsIntegrationsRouter = createHonoApp()
  .use("/:id/integrations*", withDualFormAuth("OWNER"))
  .get("/:id/integrations/google-sheets", async (c) => {
    const formId = c.req.param("id");
    const integration = await getFormIntegration(formId);
    return c.json(FormIntegrationResponseSchema.parse({ integration }));
  })
  .post(
    "/:id/integrations/google-sheets",
    zValidator("json", GoogleSheetsIntegrationSettingSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const config = c.req.valid("json");
      const integration = await upsertFormIntegration({
        formId,
        ownerUserId: auth.user_id,
        userId: auth.user_id,
        config,
      });

      return c.json(FormIntegrationResponseSchema.parse({ integration }));
    },
  )
  .post("/:id/integrations/google-sheets/sync", async (c) => {
    const formId = c.req.param("id");
    const integration = await getFormIntegration(formId);
    if (!integration) {
      return c.json({ error: "Integration not configured" }, 404);
    }

    return c.json(
      GoogleSheetsSyncUnsupportedResponseSchema.parse({
        error: "Manual Google Sheets sync is not supported",
        message:
          "Google Sheets sync jobs are queued automatically for each submitted response.",
      }),
      501,
    );
  })
  .get("/:id/integrations/google-sheets/sync/:jobId", async (c) => {
    const formId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const integration = await getFormIntegration(formId);
    if (!integration) {
      return c.json({ error: "Integration not configured" }, 404);
    }

    const job = await getSheetsSyncQueue().getJob(jobId);
    if (!job) return c.json({ error: "Job not found" }, 404);

    const state = await job.getState();
    return c.json(
      GoogleSheetsSyncJobResponseSchema.parse({
        job: {
          id: job.id,
          name: job.name,
          state,
          progress: job.progress,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
          result: job.returnvalue,
        },
      }),
    );
  });
