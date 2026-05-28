import { zValidator } from "@hono/zod-validator";
import { sheetsSyncJobDataSchema } from "@nexus-form/shared";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  GoogleSheetsIntegrationSettingSchema,
  getFormIntegration,
  upsertFormIntegrationForCurrentOwner,
} from "../lib/forms/form-integration-service";
import { createHonoApp } from "../lib/hono";
import { getSheetsSyncQueue } from "../lib/queues";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
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

const formIntegrationMutationRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyGenerator: (c) => {
    const auth = c.get("dualAuthContext");
    const subject =
      auth?.user_id !== undefined
        ? `user:${auth.user_id}`
        : `ip:${getClientIp(c)}`;
    return `rate_limit:forms-integrations:${subject}:${c.req.path}`;
  },
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
 * Google Sheets manual sync request payload.
 *
 * `force` enables a full replay of existing responses for manual synchronization.
 * If omitted, defaults to `true`.
 */
export const GoogleSheetsSyncStartRequestSchema = z.object({
  force: z.boolean().default(true),
});
/** Inferred TypeScript type for `GoogleSheetsSyncStartRequestSchema`. */
export type GoogleSheetsSyncStartRequest = z.infer<
  typeof GoogleSheetsSyncStartRequestSchema
>;

/**
 * Google Sheets sync enqueue response returned from POST endpoints.
 * @remarks The first queued job id is returned for status polling.
 */
export const GoogleSheetsSyncStartResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.literal("queued"),
});
/** Inferred TypeScript type for `GoogleSheetsSyncStartResponseSchema`. */
export type GoogleSheetsSyncStartResponse = z.infer<
  typeof GoogleSheetsSyncStartResponseSchema
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
    formIntegrationMutationRateLimit,
    async (c) => {
      const formId = c.req.param("id");
      const config = c.req.valid("json");
      const integration = await upsertFormIntegrationForCurrentOwner({
        formId,
        config,
      });
      if (!integration)
        return c.json(formIntegrationError("Form not found"), 404);

      return c.json(FormIntegrationResponseSchema.parse({ integration }));
    },
  )
  .post(
    "/:id/integrations/google-sheets/sync",
    zValidator("json", GoogleSheetsSyncStartRequestSchema),
    formIntegrationMutationRateLimit,
    async (c) => {
      const formId = c.req.param("id");
      const { force } = c.req.valid("json");
      const integration = await getFormIntegration(formId);
      if (!integration) {
        return c.json(formIntegrationError("Integration not configured"), 404);
      }

      const { db, formResponse } = await import("@nexus-form/database");

      const responses = await db
        .select({ responseId: formResponse.id })
        .from(formResponse)
        .where(eq(formResponse.formId, formId))
        .orderBy(asc(formResponse.submittedAt), asc(formResponse.id));

      if (responses.length === 0) {
        return c.json(formIntegrationError("No responses to sync"), 404);
      }

      const responseIds = force ? responses : responses.slice(-1);

      const queuedJobs = await getSheetsSyncQueue().addBulk(
        responseIds.map((response) => ({
          name: "manual-sync",
          data: sheetsSyncJobDataSchema.parse({
            formId,
            integrationId: integration.id,
            responseId: response.responseId,
          }),
        })),
      );

      const firstJob = queuedJobs[0];
      if (!firstJob) {
        return c.json(formIntegrationError("No sync jobs were queued"), 500);
      }

      return c.json(
        GoogleSheetsSyncStartResponseSchema.parse({
          jobId: firstJob.id,
          status: "queued",
        }),
        200,
      );
    },
  )
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
