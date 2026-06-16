import { db } from "@nexus-form/database";
import { form, formInvitation } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withDualAuth } from "../lib/dual-auth";
import {
  acceptInvitation,
  InvitationAcceptError,
} from "../lib/forms/permission-service";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { FormPermissionWithUser } from "../types/domain/form-permission";
import { isoDate } from "../types/domain/iso-date";

const inviteTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Error response shape returned by invite endpoints. */
export const InviteErrorResponseSchema = z.object({
  error: z.string().min(1),
});
/** Inferred TypeScript type for `InviteErrorResponseSchema`. */
export type InviteErrorResponse = z.infer<typeof InviteErrorResponseSchema>;

const inviteError = (error: string): InviteErrorResponse =>
  InviteErrorResponseSchema.parse({ error });

export const InviteLookupResponseSchema = z.object({
  invitation: z.object({
    id: z.string(),
    formId: z.string(),
    formTitle: z.string(),
    role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"]),
    message: z.string().nullable(),
    expiresAt: isoDate,
  }),
});
export type InviteLookupResponse = z.infer<typeof InviteLookupResponseSchema>;

export const InviteAcceptResponseSchema = z.object({
  permission: FormPermissionWithUser,
});
export type InviteAcceptResponse = z.infer<typeof InviteAcceptResponseSchema>;

export const formsInvitesRouter = createHonoApp()
  .get(
    "/invites/:token",
    createRateLimit({
      windowMs: 15 * 60 * 1000,
      maxRequests: 5,
      keyGenerator: (c) => `rate_limit:invite:view:${getClientIp(c)}`,
    }),
    async (c) => {
      const token = inviteTokenSchema.safeParse(c.req.param("token"));
      if (!token.success) {
        return c.json(inviteError("Invalid invite token"), 400);
      }
      const [invitation] = await db
        .select({
          id: formInvitation.id,
          formId: formInvitation.formId,
          formTitle: form.title,
          role: formInvitation.role,
          status: formInvitation.status,
          message: formInvitation.message,
          expiresAt: formInvitation.expiresAt,
        })
        .from(formInvitation)
        .innerJoin(form, eq(formInvitation.formId, form.id))
        .where(eq(formInvitation.token, token.data))
        .limit(1);

      if (!invitation) {
        return c.json(inviteError("Invitation not found"), 404);
      }
      return c.json(InviteLookupResponseSchema.parse({ invitation }));
    },
  )
  .post(
    "/invites/:token/accept",
    createRateLimit({
      windowMs: 15 * 60 * 1000,
      maxRequests: 5,
      keyGenerator: (c) => `rate_limit:invite:accept:${getClientIp(c)}`,
    }),
    withDualAuth(),
    async (c) => {
      const token = inviteTokenSchema.safeParse(c.req.param("token"));
      if (!token.success) {
        return c.json(inviteError("Invalid invite token"), 400);
      }
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(inviteError("Unauthorized"), 401);
      if (auth.auth_type !== "session") {
        return c.json(inviteError("Session authentication required"), 403);
      }
      let permission: Awaited<ReturnType<typeof acceptInvitation>>;
      try {
        permission = await acceptInvitation(token.data, auth.user_id);
      } catch (error) {
        if (error instanceof InvitationAcceptError) {
          if (error.statusCode === 403) {
            return c.json(inviteError(error.message), 403);
          }
          if (error.statusCode === 404) {
            return c.json(inviteError(error.message), 404);
          }
          if (error.statusCode === 409) {
            return c.json(inviteError(error.message), 409);
          }
          return c.json(inviteError(error.message), 410);
        }
        throw error;
      }
      return c.json(InviteAcceptResponseSchema.parse({ permission }));
    },
  );
