import { db } from "@nexus-form/database";
import { form, formInvitation } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import { withDualAuth } from "../lib/dual-auth";
import { acceptInvitation } from "../lib/forms/permission-service";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";

export const formsInvitesRouter = createHonoApp()
  .get(
    "/invites/:token",
    createRateLimit({
      windowMs: 15 * 60 * 1000,
      maxRequests: 5,
      keyGenerator: (c) => `rate_limit:invite:${getClientIp(c)}`,
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
      return c.json({ invitation });
    },
  )
  .post(
    "/invites/:token/accept",
    withDualAuth(),
    createRateLimit({
      windowMs: 15 * 60 * 1000,
      maxRequests: 5,
      keyGenerator: (c) => `rate_limit:invite:${getClientIp(c)}`,
    }),
    async (c) => {
      const token = c.req.param("token");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const permission = await acceptInvitation(token, auth.user_id);
      return c.json({ permission });
    },
  );
