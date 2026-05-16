import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import {
  formInvitation,
  formPermission,
  formShareLink,
} from "@nexus-form/database/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  acceptInvitation,
  cancelInvitation,
  checkShareLinkPermission,
  createInvitation,
  createShareLink,
  deleteShareLink,
  getFormInvitations,
  getFormPermissions,
  getShareLinks,
  getUserFormPermission,
  transferOwnership,
  updatePermissionRole,
  updateShareLink,
} from "../lib/forms/permission-service";
import { createHonoApp } from "../lib/hono";

const createPermissionSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
});

const updatePermissionSchema = z.object({
  role: z.enum(["EDITOR", "VIEWER"]),
});

const transferOwnerSchema = z.object({
  newOwnerUserId: z.string().min(1),
});

const invitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EDITOR", "VIEWER"]),
  message: z.string().max(1000).optional(),
  expiresAt: z.string().datetime().optional(),
});

const invitationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "CANCELLED"]).optional(),
});

const shareLinkCreateSchema = z.object({
  role: z.enum(["EDITOR", "VIEWER"]),
  expiresAt: z.string().datetime().optional(),
});

const shareLinkUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const shareLinksQuerySchema = paginationQuerySchema.extend({
  isActive: z.coerce.boolean().optional(),
});

export const formsPermissionsRouter = createHonoApp()
  .use("/:id/permissions*", withDualFormAuth("VIEWER"))
  .use("/:id/invitations*", withDualFormAuth("VIEWER"))
  .use("/:id/share-links*", withDualFormAuth("EDITOR"))
  .get(
    "/:id/permissions",
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const result = await getFormPermissions({
        form_id: formId,
        page: query.page,
        limit: query.pageSize,
      });
      return c.json(result);
    },
  )
  .post(
    "/:id/permissions",
    withDualFormAuth("OWNER"),
    zValidator("json", createPermissionSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");

      const [existing] = await db
        .select({ id: formPermission.id })
        .from(formPermission)
        .where(
          and(
            eq(formPermission.formId, formId),
            eq(formPermission.userId, payload.userId),
          ),
        )
        .limit(1);
      if (existing) {
        return c.json({ error: "Permission already exists" }, 409);
      }

      await db.insert(formPermission).values({
        id: randomUUID(),
        formId,
        userId: payload.userId,
        role: payload.role,
      });

      const created = await getFormPermissions({
        form_id: formId,
        page: 1,
        limit: 1,
        user_id: payload.userId,
      });

      return c.json({ permission: created.permissions[0] ?? null }, 201);
    },
  )
  .get("/:id/permissions/me", async (c) => {
    const formId = c.req.param("id");
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    const role = await getUserFormPermission(auth.user_id, formId, {
      auth_type: auth.auth_type,
      form_ids: auth.form_ids,
    });
    return c.json({ role });
  })
  .get("/:id/permissions/:userId", async (c) => {
    const formId = c.req.param("id");
    const userId = c.req.param("userId");
    const result = await getFormPermissions({
      form_id: formId,
      page: 1,
      limit: 1,
      user_id: userId,
    });
    const permission = result.permissions[0];
    if (!permission) return c.json({ error: "Permission not found" }, 404);
    return c.json({ permission });
  })
  .put(
    "/:id/permissions/:userId",
    withDualFormAuth("OWNER"),
    zValidator("json", updatePermissionSchema),
    async (c) => {
      const formId = c.req.param("id");
      const userId = c.req.param("userId");
      const payload = c.req.valid("json");
      const permission = await updatePermissionRole(
        formId,
        userId,
        payload.role,
      );
      return c.json({ permission });
    },
  )
  .delete("/:id/permissions/:userId", withDualFormAuth("OWNER"), async (c) => {
    const formId = c.req.param("id");
    const userId = c.req.param("userId");

    const [target] = await db
      .select({ id: formPermission.id })
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, userId),
        ),
      )
      .limit(1);
    if (!target) return c.json({ error: "Permission not found" }, 404);

    await db.delete(formPermission).where(eq(formPermission.id, target.id));
    return c.json({ ok: true });
  })
  .post(
    "/:id/permissions/transfer-owner",
    withDualFormAuth("OWNER"),
    zValidator("json", transferOwnerSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const payload = c.req.valid("json");
      await transferOwnership(formId, payload.newOwnerUserId, auth.user_id);
      return c.json({ ok: true });
    },
  )
  .get(
    "/:id/invitations",
    zValidator("query", invitationsQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const invitations = await getFormInvitations(
        formId,
        query.page,
        query.pageSize,
        query.status,
      );
      return c.json(invitations);
    },
  )
  .post(
    "/:id/invitations",
    withDualFormAuth("EDITOR"),
    zValidator("json", invitationCreateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const payload = c.req.valid("json");
      const invitation = await createInvitation(
        formId,
        payload.email,
        payload.role,
        auth.user_id,
        payload.message,
        payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      );
      return c.json({ invitation }, 201);
    },
  )
  .get("/:id/invitations/:invitationId", async (c) => {
    const formId = c.req.param("id");
    const invitationId = c.req.param("invitationId");
    const [invitation] = await db
      .select()
      .from(formInvitation)
      .where(
        and(
          eq(formInvitation.id, invitationId),
          eq(formInvitation.formId, formId),
        ),
      )
      .limit(1);
    if (!invitation) return c.json({ error: "Invitation not found" }, 404);
    return c.json({ invitation });
  })
  .delete(
    "/:id/invitations/:invitationId",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const invitationId = c.req.param("invitationId");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      await cancelInvitation(invitationId, auth.user_id, formId);
      return c.json({ ok: true });
    },
  )
  .get(
    "/:id/share-links",
    zValidator("query", shareLinksQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const links = await getShareLinks(
        formId,
        query.page,
        query.pageSize,
        query.isActive,
      );
      return c.json(links);
    },
  )
  .post(
    "/:id/share-links",
    withDualFormAuth("EDITOR"),
    zValidator("json", shareLinkCreateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const allowed = await checkShareLinkPermission(auth.user_id, formId, {
        auth_type: auth.auth_type,
        form_ids: auth.form_ids,
      });
      if (!allowed) return c.json({ error: "Insufficient permissions" }, 403);

      const payload = c.req.valid("json");
      const link = await createShareLink(
        formId,
        payload.role,
        auth.user_id,
        payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      );
      return c.json({ shareLink: link }, 201);
    },
  )
  .get("/:id/share-links/:linkId", async (c) => {
    const formId = c.req.param("id");
    const linkId = c.req.param("linkId");
    const [link] = await db
      .select()
      .from(formShareLink)
      .where(
        and(eq(formShareLink.id, linkId), eq(formShareLink.formId, formId)),
      )
      .limit(1);
    if (!link) return c.json({ error: "Share link not found" }, 404);
    return c.json({ shareLink: link });
  })
  .put(
    "/:id/share-links/:linkId",
    withDualFormAuth("EDITOR"),
    zValidator("json", shareLinkUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const linkId = c.req.param("linkId");
      const payload = c.req.valid("json");
      const link = await updateShareLink(linkId, formId, {
        isActive: payload.isActive,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      });
      return c.json({ shareLink: link });
    },
  )
  .delete("/:id/share-links/:linkId", withDualFormAuth("EDITOR"), async (c) => {
    const formId = c.req.param("id");
    const linkId = c.req.param("linkId");
    await deleteShareLink(linkId, formId);
    return c.json({ ok: true });
  })
  .post(
    "/:id/invitations/:token/accept",
    withDualFormAuth("VIEWER"),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const token = c.req.param("token");
      const permission = await acceptInvitation(token, auth.user_id);
      return c.json({ permission });
    },
  );
