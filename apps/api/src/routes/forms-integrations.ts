import { zValidator } from "@hono/zod-validator";
import { sheetsSyncJobDataSchema } from "@nexus-form/shared";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  GoogleSheetsIntegrationSettingSchema,
  getFormIntegration,
  upsertFormIntegration,
} from "../lib/forms/form-integration-service";
import { createHonoApp } from "../lib/hono";
import { getSheetsSyncQueue } from "../lib/queues";
import { isoDate } from "../types/domain/iso-date";

const FormIntegrationRecordSchema = z.object({
  id: z.string(),
  formId: z.string(),
  ownerUserId: z.string(),
  userId: z.string().nullable(),
  config: GoogleSheetsIntegrationSettingSchema,
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** Error response shape returned by form integration endpoints. */
export const FormIntegrationErrorResponseSchema = z.object({
  error: z.string().min(1),
});
/** Inferred TypeScript type for `FormIntegrationErrorResponseSchema`. */
export type FormIntegrationErrorResponse = z.infer<
  typeof FormIntegrationErrorResponseSchema
>;

const formIntegrationError = (error: string): FormIntegrationErrorResponse => ({
  error,
});

/**
 * Google Sheets integration read/save response for 200 OK endpoints.
 * @remarks `integration` is nullable when the form has not configured Google Sheets.
 */
export const FormIntegrationResponseSchema = z.object({
  integration: FormIntegrationRecordSchema.nullable(),
});
/** Inferred TypeScript type for `FormIntegrationResponseSchema`. */
export type FormIntegrationResponse = z.infer<
  typeof FormIntegrationResponseSchema
>;

/**
 * Manual Google Sheets sync unsupported response returned with 501.
 * @remarks `error` is a stable literal and `message` explains automatic sync behavior.
 */
export const GoogleSheetsSyncUnsupportedResponseSchema = z.object({
  error: z.literal("Manual Google Sheets sync is not supported"),
  message: z.string(),
});
/** Inferred TypeScript type for `GoogleSheetsSyncUnsupportedResponseSchema`. */
export type GoogleSheetsSyncUnsupportedResponse = z.infer<
  typeof GoogleSheetsSyncUnsupportedResponseSchema
>;

/**
 * Google Sheets sync job status response returned with 200 OK.
 * @remarks The `job` object exposes BullMQ status fields including progress, result, attempts, and failure reason.
 */
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
/** Inferred TypeScript type for `GoogleSheetsSyncJobResponseSchema`. */
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
      if (!auth) return c.json(formIntegrationError("Unauthorized"), 401);

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
      return c.json(formIntegrationError("Integration not configured"), 404);
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
      return c.json(formIntegrationError("Integration not configured"), 404);
    }

    const job = await getSheetsSyncQueue().getJob(jobId);
    if (!job) return c.json(formIntegrationError("Job not found"), 404);
    const jobData = sheetsSyncJobDataSchema.safeParse(job.data);
    if (
      !jobData.success ||
      jobData.data.formId !== formId ||
      jobData.data.integrationId !== integration.id
    ) {
      return c.json(formIntegrationError("Job not found"), 404);
    }

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
