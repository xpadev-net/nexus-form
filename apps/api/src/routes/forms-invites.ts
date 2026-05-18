import { db } from "@nexus-form/database";
import { form, formInvitation } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withDualAuth } from "../lib/dual-auth";
import { acceptInvitation } from "../lib/forms/permission-service";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { FormPermission } from "../types/domain/form-permission";

export const InviteLookupResponseSchema = z.object({
  invitation: z.object({
    id: z.string(),
    formId: z.string(),
    formTitle: z.string(),
    email: z.string().email(),
    role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"]),
    message: z.string().nullable(),
    expiresAt: z.date(),
  }),
});
export type InviteLookupResponse = z.infer<typeof InviteLookupResponseSchema>;

export const InviteAcceptResponseSchema = z.object({
  permission: FormPermission,
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
      const token = c.req.param("token");
      const [invitation] = await db
        .select({
          id: formInvitation.id,
          formId: formInvitation.formId,
          formTitle: form.title,
          email: formInvitation.email,
          role: formInvitation.role,
          status: formInvitation.status,
          message: formInvitation.message,
          expiresAt: formInvitation.expiresAt,
        })
        .from(formInvitation)
        .innerJoin(form, eq(formInvitation.formId, form.id))
        .where(eq(formInvitation.token, token))
        .limit(1);

      if (!invitation) return c.json({ error: "Invitation not found" }, 404);
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
      const token = c.req.param("token");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const permission = await acceptInvitation(token, auth.user_id);
      return c.json(InviteAcceptResponseSchema.parse({ permission }));
    },
  );
