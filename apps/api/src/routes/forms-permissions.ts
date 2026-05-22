import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, user } from "@nexus-form/database";
import {
  formInvitation,
  formPermission,
  formShareLink,
} from "@nexus-form/database/schema";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { type DualAuthContext, withDualFormAuth } from "../lib/dual-auth";
import { FormPermissionError } from "../lib/errors/form-errors";
import {
  cancelInvitation,
  createInvitation,
  createShareLink,
  deleteShareLink,
  getFormInvitations,
  getFormPermissions,
  getShareLinks,
  getUserFormPermission,
  PermissionRemovalError,
  removePermission,
  transferOwnership,
  updatePermissionRole,
  updateShareLink,
  validateShareLinkRole,
} from "../lib/forms/permission-service";
import { createHonoApp, type Env } from "../lib/hono";
import {
  FormInvitationListResponse,
  FormInvitationStatus,
  FormInvitationWithInviter,
  FormPermissionListResponse,
  FormPermissionType,
  FormPermissionWithUser,
  FormShareLink,
  FormShareLinkListResponse,
} from "../types/domain/form-permission";
import {
  type ErrorResponse,
  errorResponse,
  OkResponseSchema,
} from "../types/domain/form-row";

const createPermissionSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["EDITOR", "VIEWER"]),
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

function isSyntheticShareLinkPrincipal(auth: DualAuthContext): boolean {
  return (
    auth.auth_type === "api_token" &&
    (auth.share_link_id !== undefined ||
      auth.user_id.startsWith("share-link:") ||
      auth.user_id.startsWith("anon:"))
  );
}

const rejectSyntheticShareLinkManagementAuth = createMiddleware<Env>(
  async (c, next) => {
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json(errorResponse("Unauthorized"), 401);
    if (isSyntheticShareLinkPrincipal(auth)) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }
    return next();
  },
);

export const FormPermissionResponseSchema = z.object({
  permission: FormPermissionWithUser,
});
export type FormPermissionResponse = z.infer<
  typeof FormPermissionResponseSchema
>;

export const NullableFormPermissionResponseSchema = z.object({
  permission: FormPermissionWithUser.nullable(),
});
export type NullableFormPermissionResponse = z.infer<
  typeof NullableFormPermissionResponseSchema
>;

export const UserFormPermissionResponseSchema = z.object({
  role: FormPermissionType.nullable(),
});
export type UserFormPermissionResponse = z.infer<
  typeof UserFormPermissionResponseSchema
>;

export const FormInvitationResponseSchema = z.object({
  invitation: FormInvitationWithInviter,
});
export type FormInvitationResponse = z.infer<
  typeof FormInvitationResponseSchema
>;

export const FormShareLinkResponseSchema = z.object({
  shareLink: FormShareLink,
});
export type FormShareLinkResponse = z.infer<typeof FormShareLinkResponseSchema>;

export type FormPermissionErrorResponse = ErrorResponse;

export const formsPermissionsRouter = createHonoApp()
  .use("/:id/permissions*", withDualFormAuth("VIEWER"))
  .use("/:id/share-links*", withDualFormAuth("EDITOR"))
  .get(
    "/:id/permissions",
    withDualFormAuth("EDITOR"),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const result = await getFormPermissions({
        form_id: formId,
        page: query.page,
        limit: query.pageSize,
      });
      return c.json(FormPermissionListResponse.parse(result));
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
        return c.json(errorResponse("Permission already exists"), 409);
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

      return c.json(
        NullableFormPermissionResponseSchema.parse({
          permission: created.permissions[0] ?? null,
        }),
        201,
      );
    },
  )
  .get("/:id/permissions/me", async (c) => {
    const formId = c.req.param("id");
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json(errorResponse("Unauthorized"), 401);
    const role = await getUserFormPermission(auth.user_id, formId, {
      auth_type: auth.auth_type,
      form_ids: auth.form_ids,
    });
    return c.json(UserFormPermissionResponseSchema.parse({ role }));
  })
  .get("/:id/permissions/:userId", withDualFormAuth("EDITOR"), async (c) => {
    const formId = c.req.param("id");
    const userId = c.req.param("userId");
    const result = await getFormPermissions({
      form_id: formId,
      page: 1,
      limit: 1,
      user_id: userId,
    });
    const permission = result.permissions[0];
    if (!permission) {
      return c.json(errorResponse("Permission not found"), 404);
    }
    return c.json(FormPermissionResponseSchema.parse({ permission }));
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
      return c.json(FormPermissionResponseSchema.parse({ permission }));
    },
  )
  .delete("/:id/permissions/:userId", withDualFormAuth("OWNER"), async (c) => {
    const formId = c.req.param("id");
    const userId = c.req.param("userId");

    try {
      await removePermission(formId, userId);
    } catch (error) {
      if (error instanceof PermissionRemovalError) {
        if (
          error.code === "FORM_NOT_FOUND" ||
          error.code === "PERMISSION_NOT_FOUND"
        ) {
          return c.json(errorResponse(error.message), 404);
        }
        if (error.code === "OWNER_PERMISSION_REMOVAL_FORBIDDEN") {
          return c.json(errorResponse(error.message), 409);
        }
      }
      throw error;
    }

    return c.json(OkResponseSchema.parse({ ok: true }));
  })
  .post(
    "/:id/permissions/transfer-owner",
    withDualFormAuth("OWNER"),
    zValidator("json", transferOwnerSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);
      const payload = c.req.valid("json");
      await transferOwnership(formId, payload.newOwnerUserId, auth.user_id);
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  )
  .get(
    "/:id/invitations",
    withDualFormAuth("EDITOR"),
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
      return c.json(FormInvitationListResponse.parse(invitations));
    },
  )
  .post(
    "/:id/invitations",
    withDualFormAuth("EDITOR"),
    zValidator("json", invitationCreateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);
      const payload = c.req.valid("json");
      const invitation = await createInvitation(
        formId,
        payload.email,
        payload.role,
        auth.user_id,
        payload.message,
        payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      );
      return c.json(FormInvitationResponseSchema.parse({ invitation }), 201);
    },
  )
  .get(
    "/:id/invitations/:invitationId",
    withDualFormAuth("EDITOR"),
    async (c) => {
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
      if (!invitation) {
        return c.json(errorResponse("Invitation not found"), 404);
      }
      const [inviter] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(eq(user.id, invitation.invitedBy))
        .limit(1);
      if (!inviter) {
        throw new Error("Inviter not found");
      }
      return c.json(
        FormInvitationResponseSchema.parse({
          invitation: {
            id: invitation.id,
            form_id: invitation.formId,
            email: invitation.email,
            role: invitation.role,
            token: invitation.token,
            status: FormInvitationStatus.parse(invitation.status),
            message: invitation.message ?? undefined,
            expires_at: invitation.expiresAt.toISOString(),
            created_at: invitation.createdAt.toISOString(),
            updated_at: invitation.updatedAt.toISOString(),
            invited_by: invitation.invitedBy,
            inviter: {
              id: inviter.id,
              name: inviter.name,
              email: inviter.email,
              discord_id: null,
              created_at: inviter.createdAt.toISOString(),
              updated_at: inviter.updatedAt.toISOString(),
            },
          },
        }),
      );
    },
  )
  .delete(
    "/:id/invitations/:invitationId",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const invitationId = c.req.param("invitationId");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);
      try {
        await cancelInvitation(invitationId, auth.user_id, formId);
      } catch (error) {
        if (error instanceof FormPermissionError) {
          return c.json(
            errorResponse(error.message),
            error.statusCode as 403 | 404,
          );
        }
        throw error;
      }
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  )
  .get(
    "/:id/share-links",
    withDualFormAuth("EDITOR"),
    rejectSyntheticShareLinkManagementAuth,
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
      return c.json(FormShareLinkListResponse.parse(links));
    },
  )
  .post(
    "/:id/share-links",
    withDualFormAuth("EDITOR"),
    rejectSyntheticShareLinkManagementAuth,
    zValidator("json", shareLinkCreateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);
      const context = {
        auth_type: auth.auth_type,
        form_ids: auth.form_ids,
      };
      const payload = c.req.valid("json");
      const userRole = await getUserFormPermission(
        auth.user_id,
        formId,
        context,
      );
      if (!userRole || !validateShareLinkRole(payload.role, userRole)) {
        return c.json(errorResponse("Insufficient permissions"), 403);
      }

      const link = await createShareLink(
        formId,
        payload.role,
        auth.user_id,
        payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      );
      return c.json(
        FormShareLinkResponseSchema.parse({ shareLink: link }),
        201,
      );
    },
  )
  .get(
    "/:id/share-links/:linkId",
    withDualFormAuth("EDITOR"),
    rejectSyntheticShareLinkManagementAuth,
    async (c) => {
      const formId = c.req.param("id");
      const linkId = c.req.param("linkId");
      const [link] = await db
        .select()
        .from(formShareLink)
        .where(
          and(eq(formShareLink.id, linkId), eq(formShareLink.formId, formId)),
        )
        .limit(1);
      if (!link) {
        return c.json(errorResponse("Share link not found"), 404);
      }
      return c.json(
        FormShareLinkResponseSchema.parse({
          shareLink: {
            id: link.id,
            form_id: link.formId,
            token: link.token,
            role: link.role,
            is_active: link.isActive,
            expires_at: link.expiresAt?.toISOString(),
            created_at: link.createdAt.toISOString(),
            updated_at: link.updatedAt.toISOString(),
            created_by: link.createdBy,
          },
        }),
      );
    },
  )
  .put(
    "/:id/share-links/:linkId",
    withDualFormAuth("EDITOR"),
    rejectSyntheticShareLinkManagementAuth,
    zValidator("json", shareLinkUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const linkId = c.req.param("linkId");
      const payload = c.req.valid("json");
      const link = await updateShareLink(linkId, formId, {
        isActive: payload.isActive,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      });
      return c.json(FormShareLinkResponseSchema.parse({ shareLink: link }));
    },
  )
  .delete(
    "/:id/share-links/:linkId",
    withDualFormAuth("EDITOR"),
    rejectSyntheticShareLinkManagementAuth,
    async (c) => {
      const formId = c.req.param("id");
      const linkId = c.req.param("linkId");
      await deleteShareLink(linkId, formId);
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  );
