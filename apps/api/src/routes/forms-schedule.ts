import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { formSchedule } from "@nexus-form/database/schema";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  paginationMetadata,
  paginationQuerySchema,
} from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { isoDate } from "../types/domain/iso-date";
import { routePaginationSchema } from "./form-route-schemas";

const futureDatetime = z
  .string()
  .datetime()
  .refine((val) => new Date(val) > new Date(), {
    message: "triggerAt must be in the future",
  });

const scheduleCreateSchema = z.discriminatedUnion("action", [
  z.object({ triggerAt: futureDatetime, action: z.literal("PUBLISH") }),
  z.object({
    triggerAt: futureDatetime,
    action: z.literal("UNPUBLISH"),
  }),
  z.object({
    triggerAt: futureDatetime,
    action: z.literal("SWITCH_SNAPSHOT"),
    snapshotVersion: z.number().int().min(1),
  }),
]);

const scheduleUpdateSchema = z
  .object({
    triggerAt: futureDatetime.optional(),
    action: z.enum(["PUBLISH", "UNPUBLISH", "SWITCH_SNAPSHOT"]).optional(),
    snapshotVersion: z.number().int().min(1).nullable().optional(),
  })
  .refine(
    (data) =>
      data.action !== "SWITCH_SNAPSHOT" ||
      (data.snapshotVersion !== null && data.snapshotVersion !== undefined),
    { message: "snapshotVersion is required for SWITCH_SNAPSHOT action" },
  );

const FormScheduleResponseSchema = z.object({
  id: z.string(),
  formId: z.string(),
  triggerAt: isoDate,
  action: z.enum(["PUBLISH", "UNPUBLISH", "SWITCH_SNAPSHOT"]),
  snapshotVersion: z.number().int().min(1).nullable(),
  processedAt: isoDate.nullable(),
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED"]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
type FormScheduleRow = typeof formSchedule.$inferSelect;

function serializeSchedule(schedule: FormScheduleRow) {
  return {
    ...schedule,
    status: !schedule.processedAt
      ? "PENDING"
      : schedule.processedAt < schedule.triggerAt
        ? "CANCELLED"
        : "COMPLETED",
  } satisfies z.input<typeof FormScheduleResponseSchema>;
}

const FormScheduleEnvelopeSchema = z.object({
  schedule: FormScheduleResponseSchema,
});
export type FormScheduleEnvelope = z.infer<typeof FormScheduleEnvelopeSchema>;

const NullableFormScheduleEnvelopeSchema = z.object({
  schedule: FormScheduleResponseSchema.nullable(),
});
export type NullableFormScheduleEnvelope = z.infer<
  typeof NullableFormScheduleEnvelopeSchema
>;

const FormScheduleListResponseSchema = z.object({
  schedules: z.array(FormScheduleResponseSchema),
  pagination: routePaginationSchema,
});
export type FormScheduleListResponse = z.infer<
  typeof FormScheduleListResponseSchema
>;

const FormScheduleErrorResponseSchema = z.object({
  error: z.string().min(1),
});
export type FormScheduleErrorResponse = z.infer<
  typeof FormScheduleErrorResponseSchema
>;

const formScheduleError = (error: string): FormScheduleErrorResponse => {
  const parsed = FormScheduleErrorResponseSchema.safeParse({ error });
  return parsed.success ? parsed.data : { error: "Request failed" };
};

const formsScheduleMutationRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyGenerator: (c) => {
    const auth = c.get("dualAuthContext");
    const subject =
      auth?.user_id !== undefined
        ? `user:${auth.user_id}`
        : `ip:${getClientIp(c)}`;
    return `rate_limit:forms-schedule:${subject}:${c.req.path}`;
  },
});

const OkResponseSchema = z.object({ ok: z.literal(true) });

export const formsScheduleRouter = createHonoApp()
  .use("/:id/schedule*", withDualFormAuth("VIEWER"))
  .get(
    "/:id/schedule",
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const [schedules, totalResult] = await Promise.all([
        db
          .select()
          .from(formSchedule)
          .where(eq(formSchedule.formId, formId))
          .orderBy(asc(formSchedule.triggerAt), asc(formSchedule.id))
          .offset(offset)
          .limit(pageSize),
        db
          .select({ count: count() })
          .from(formSchedule)
          .where(eq(formSchedule.formId, formId)),
      ]);
      const total = totalResult[0]?.count ?? 0;
      return c.json(
        FormScheduleListResponseSchema.parse({
          schedules: schedules.map(serializeSchedule),
          pagination: paginationMetadata(page, pageSize, total),
        }),
      );
    },
  )
  .post(
    "/:id/schedule",
    withDualFormAuth("EDITOR"),
    formsScheduleMutationRateLimit,
    zValidator("json", scheduleCreateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");
      const id = randomUUID();
      await db.insert(formSchedule).values({
        id,
        formId,
        triggerAt: new Date(payload.triggerAt),
        action: payload.action,
        snapshotVersion:
          payload.action === "SWITCH_SNAPSHOT" ? payload.snapshotVersion : null,
      });
      const [schedule] = await db
        .select()
        .from(formSchedule)
        .where(eq(formSchedule.id, id))
        .limit(1);
      if (!schedule) {
        throw new Error("Created schedule not found");
      }
      return c.json(
        FormScheduleEnvelopeSchema.parse({
          schedule: serializeSchedule(schedule),
        }),
        201,
      );
    },
  )
  .get("/:id/schedule/:scheduleId", async (c) => {
    const formId = c.req.param("id");
    const scheduleId = c.req.param("scheduleId");
    const [schedule] = await db
      .select()
      .from(formSchedule)
      .where(
        and(eq(formSchedule.id, scheduleId), eq(formSchedule.formId, formId)),
      )
      .limit(1);
    if (!schedule) return c.json(formScheduleError("Schedule not found"), 404);
    return c.json(
      FormScheduleEnvelopeSchema.parse({
        schedule: serializeSchedule(schedule),
      }),
    );
  })
  .put(
    "/:id/schedule/:scheduleId",
    withDualFormAuth("EDITOR"),
    formsScheduleMutationRateLimit,
    zValidator("json", scheduleUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const scheduleId = c.req.param("scheduleId");
      const payload = c.req.valid("json");

      const [schedule] = await db
        .select()
        .from(formSchedule)
        .where(
          and(eq(formSchedule.id, scheduleId), eq(formSchedule.formId, formId)),
        )
        .limit(1);
      if (!schedule) {
        return c.json(formScheduleError("Schedule not found"), 404);
      }
      if (schedule.processedAt) {
        return c.json(
          formScheduleError("Schedule cannot be edited after execution"),
          409,
        );
      }

      const effectiveAction = payload.action ?? schedule.action;
      const effectiveSnapshotVersion =
        payload.snapshotVersion === null
          ? null
          : payload.snapshotVersion !== undefined
            ? payload.snapshotVersion
            : schedule.snapshotVersion;

      if (
        effectiveAction === "SWITCH_SNAPSHOT" &&
        effectiveSnapshotVersion == null
      ) {
        return c.json(
          formScheduleError(
            "snapshotVersion is required for SWITCH_SNAPSHOT action",
          ),
          400,
        );
      }

      await db
        .update(formSchedule)
        .set({
          triggerAt: payload.triggerAt
            ? new Date(payload.triggerAt)
            : undefined,
          action: payload.action,
          snapshotVersion:
            effectiveAction === "SWITCH_SNAPSHOT"
              ? effectiveSnapshotVersion
              : null,
        })
        .where(eq(formSchedule.id, scheduleId));

      const [updated] = await db
        .select()
        .from(formSchedule)
        .where(eq(formSchedule.id, scheduleId))
        .limit(1);

      return c.json(
        NullableFormScheduleEnvelopeSchema.parse({
          schedule: updated ? serializeSchedule(updated) : null,
        }),
      );
    },
  )
  .delete(
    "/:id/schedule/:scheduleId",
    withDualFormAuth("EDITOR"),
    formsScheduleMutationRateLimit,
    async (c) => {
      const formId = c.req.param("id");
      const scheduleId = c.req.param("scheduleId");
      const [target] = await db
        .select({
          id: formSchedule.id,
          triggerAt: formSchedule.triggerAt,
          processedAt: formSchedule.processedAt,
        })
        .from(formSchedule)
        .where(
          and(eq(formSchedule.id, scheduleId), eq(formSchedule.formId, formId)),
        )
        .limit(1);
      if (!target) {
        return c.json(formScheduleError("Schedule not found"), 404);
      }
      if (target.processedAt) {
        return c.json(
          formScheduleError("Schedule cannot be cancelled after execution"),
          400,
        );
      }
      const cancelledAt = new Date(target.triggerAt.getTime() - 1000);
      const updateResult = await db
        .update(formSchedule)
        .set({ processedAt: cancelledAt })
        .where(
          and(
            eq(formSchedule.id, scheduleId),
            eq(formSchedule.formId, formId),
            isNull(formSchedule.processedAt),
          ),
        );
      if ((updateResult[0]?.affectedRows ?? 0) === 0) {
        return c.json(
          formScheduleError(
            "Schedule was already processed and cannot be cancelled",
          ),
          409,
        );
      }
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  );
