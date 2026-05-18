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

const syncPayloadSchema = z.object({
  force: z.boolean().optional(),
});

export const formsIntegrationsRouter = createHonoApp()
  .use("/:id/integrations*", withDualFormAuth("OWNER"))
  .get("/:id/integrations/google-sheets", async (c) => {
    const formId = c.req.param("id");
    const integration = await getFormIntegration(formId);
    return c.json({ integration });
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

      return c.json({ integration });
    },
  )
  .post(
    "/:id/integrations/google-sheets/sync",
    zValidator("json", syncPayloadSchema),
    async (c) => {
      const formId = c.req.param("id");
      const integration = await getFormIntegration(formId);
      if (!integration) {
        return c.json({ error: "Integration not configured" }, 404);
      }

      return c.json(
        {
          error: "Manual Google Sheets sync is not supported",
          message:
            "Google Sheets sync jobs are queued automatically for each submitted response.",
        },
        501,
      );
    },
  )
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
    return c.json({
      job: {
        id: job.id,
        name: job.name,
        state,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        result: job.returnvalue,
      },
    });
  });
