import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { apiToken } from "@nexus-form/database/schema";
import { and, count, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import {
  createApiToken,
  deleteApiToken,
  revokeApiToken,
  validateApiToken,
} from "../lib/tokens";
import {
  CreateTokenResponse,
  DeleteTokenResponse,
  GetTokenResponse,
  GetTokensResponse,
  RevokeTokenResponse,
  UpdateTokenResponse,
  ValidateTokenResponse,
} from "../types/api/auth";

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
  form_ids: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});

const patchTokenSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    scopes: z
      .array(z.enum(["read", "write", "admin"]))
      .min(1)
      .optional(),
    form_ids: z.array(z.string()).optional(),
    expires_at: z.string().datetime().nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const validateTokenSchema = z.object({
  token: z.string().min(1),
});

function requireSessionUser(
  c: Context,
): { ok: true; userId: string } | { ok: false; response: Response } {
  const auth = c.get("dualAuthContext");
  if (!auth || auth.auth_type !== "session") {
    return { ok: false, response: c.json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true, userId: auth.user_id };
}

export const tokensRouter = createHonoApp()
  .use("/*", withDualAuth())
  .get("/", zValidator("query", paginationQuerySchema), async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const { page, pageSize } = c.req.valid("query");
    const offset = (page - 1) * pageSize;

    const where = and(
      eq(apiToken.userId, user.userId),
      eq(apiToken.isActive, true),
    );
    const [tokens, totalRows] = await Promise.all([
      db
        .select({
          id: apiToken.id,
          name: apiToken.name,
          scopes: apiToken.scopes,
          formIds: apiToken.formIds,
          expiresAt: apiToken.expiresAt,
          lastUsedAt: apiToken.lastUsedAt,
          createdAt: apiToken.createdAt,
          isActive: apiToken.isActive,
        })
        .from(apiToken)
        .where(where)
        .orderBy(desc(apiToken.createdAt))
        .offset(offset)
        .limit(pageSize),
      db.select({ total: count() }).from(apiToken).where(where),
    ]);

    const total = totalRows[0]?.total ?? 0;
    const listResponse = GetTokensResponse.parse({
      tokens: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        scopes: token.scopes,
        form_ids: token.formIds,
        expires_at: token.expiresAt?.toISOString(),
        last_used_at: token.lastUsedAt?.toISOString(),
        created_at: token.createdAt.toISOString(),
        is_active: token.isActive,
      })),
      total,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: page * pageSize < total,
        hasPrev: page > 1,
      },
    });
    return c.json(listResponse);
  })
  .post("/", zValidator("json", createTokenSchema), async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const payload = c.req.valid("json");
    const created = await createApiToken(user.userId, payload);
    const createResponse = CreateTokenResponse.parse({
      token: {
        id: created.id,
        name: created.name,
        token: created.token,
        scopes: created.scopes,
        form_ids: created.formIds,
        expires_at: created.expiresAt?.toISOString(),
        created_at: created.createdAt.toISOString(),
        is_active: true,
      },
      message: "API token created successfully",
    });
    return c.json(createResponse, 201);
  })
  .get("/:id", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const id = c.req.param("id");
    const [token] = await db
      .select({
        id: apiToken.id,
        name: apiToken.name,
        scopes: apiToken.scopes,
        formIds: apiToken.formIds,
        expiresAt: apiToken.expiresAt,
        lastUsedAt: apiToken.lastUsedAt,
        createdAt: apiToken.createdAt,
        isActive: apiToken.isActive,
      })
      .from(apiToken)
      .where(and(eq(apiToken.id, id), eq(apiToken.userId, user.userId)))
      .limit(1);

    if (!token) return c.json({ error: "Token not found" }, 404);

    const detailResponse = GetTokenResponse.parse({
      token: {
        id: token.id,
        name: token.name,
        scopes: token.scopes,
        form_ids: token.formIds,
        expires_at: token.expiresAt?.toISOString(),
        last_used_at: token.lastUsedAt?.toISOString(),
        created_at: token.createdAt.toISOString(),
        is_active: token.isActive,
      },
    });
    return c.json(detailResponse);
  })
  .patch("/:id", zValidator("json", patchTokenSchema), async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const id = c.req.param("id");
    const payload = c.req.valid("json");
    const patch: {
      name?: string;
      scopes?: unknown;
      formIds?: string[];
      expiresAt?: Date | null;
      isActive?: boolean;
      revokedAt?: Date | null;
    } = {};
    if (payload.name !== undefined) patch.name = payload.name;
    if (payload.scopes !== undefined) patch.scopes = payload.scopes;
    if (payload.form_ids !== undefined) patch.formIds = payload.form_ids;
    if (payload.expires_at !== undefined) {
      patch.expiresAt = payload.expires_at
        ? new Date(payload.expires_at)
        : null;
    }
    if (payload.is_active !== undefined) {
      patch.isActive = payload.is_active;
      patch.revokedAt = payload.is_active ? null : new Date();
    }

    await db
      .update(apiToken)
      .set(patch)
      .where(and(eq(apiToken.id, id), eq(apiToken.userId, user.userId)));

    const [updated] = await db
      .select({
        id: apiToken.id,
        name: apiToken.name,
        scopes: apiToken.scopes,
        formIds: apiToken.formIds,
        expiresAt: apiToken.expiresAt,
        lastUsedAt: apiToken.lastUsedAt,
        createdAt: apiToken.createdAt,
        isActive: apiToken.isActive,
      })
      .from(apiToken)
      .where(and(eq(apiToken.id, id), eq(apiToken.userId, user.userId)))
      .limit(1);

    if (!updated) return c.json({ error: "Token not found" }, 404);
    const updateResponse = UpdateTokenResponse.parse({
      token: {
        id: updated.id,
        name: updated.name,
        scopes: updated.scopes,
        form_ids: updated.formIds,
        expires_at: updated.expiresAt?.toISOString(),
        last_used_at: updated.lastUsedAt?.toISOString(),
        created_at: updated.createdAt.toISOString(),
        is_active: updated.isActive,
      },
      message: "API token updated successfully",
    });
    return c.json(updateResponse);
  })
  .delete("/:id", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const id = c.req.param("id");
    const success = await deleteApiToken(id, user.userId);
    if (!success) {
      return c.json({ error: "Token not found or already deleted" }, 404);
    }
    return c.json(
      DeleteTokenResponse.parse({
        message: "API token deleted successfully",
      }),
    );
  })
  .post("/:id/revoke", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const id = c.req.param("id");
    const success = await revokeApiToken(id, user.userId);
    if (!success) {
      return c.json({ error: "Token not found or already revoked" }, 404);
    }
    return c.json(
      RevokeTokenResponse.parse({
        message: "API token revoked successfully",
      }),
    );
  })
  .post("/validate", zValidator("json", validateTokenSchema), async (c) => {
    const { token } = c.req.valid("json");
    const authContext = await validateApiToken(token);

    if (!authContext) {
      return c.json(
        {
          error: {
            message: "Invalid or expired token",
            code: "INVALID_TOKEN",
          },
        },
        401,
      );
    }

    return c.json(
      ValidateTokenResponse.parse({
        valid: true,
        user_id: authContext.user_id,
        scopes: authContext.scopes,
      }),
    );
  });
