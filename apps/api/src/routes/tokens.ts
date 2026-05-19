import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { apiToken } from "@nexus-form/database/schema";
import {
  apiTokenFormIdsSchema,
  apiTokenScopesSchema,
} from "@nexus-form/shared";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { ERROR_CODES } from "../lib/constants/error-codes";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import {
  createApiToken,
  deleteApiToken,
  getUserApiTokens,
  revokeApiToken,
  SuspendedTokenOwnerError,
  validateApiTokenForUser,
} from "../lib/tokens";
import { parseStoredApiTokenJson } from "../lib/tokens/stored-json";
import {
  CreateTokenResponse,
  DeleteTokenResponse,
  GetTokenResponse,
  GetTokensResponse,
  RevokeTokenResponse,
  UpdateTokenResponse,
  ValidateTokenResponse,
} from "../types/api/auth";
import { errorResponse } from "../types/domain/common";

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: apiTokenScopesSchema,
  form_ids: apiTokenFormIdsSchema.optional(),
  expires_at: z.string().datetime().optional(),
});

const patchTokenSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    scopes: apiTokenScopesSchema.optional(),
    form_ids: apiTokenFormIdsSchema.nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const validateTokenSchema = z.object({
  token: z.string().min(1),
});

/** 停止中ユーザーが所有する API トークン検証時のエラーレスポンス。 */
export const SuspendedTokenOwnerErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string(),
  }),
});
export type SuspendedTokenOwnerErrorResponse = z.infer<
  typeof SuspendedTokenOwnerErrorResponseSchema
>;

const suspendedTokenOwnerErrorResponse = (): SuspendedTokenOwnerErrorResponse =>
  SuspendedTokenOwnerErrorResponseSchema.parse({
    error: {
      message: SuspendedTokenOwnerError.MESSAGE,
      code: ERROR_CODES.FORBIDDEN,
    },
  });

function requireSessionUser(
  c: Context,
):
  | { ok: true; userId: string; isAdmin: boolean }
  | { ok: false; response: Response } {
  const auth = c.get("dualAuthContext");
  if (!auth || auth.auth_type !== "session") {
    return { ok: false, response: c.json(errorResponse("Unauthorized"), 401) };
  }
  return {
    ok: true,
    userId: auth.user_id,
    isAdmin: auth.session?.user?.role === "admin",
  };
}

function rejectNonAdminScope(
  c: Context,
  scopes: readonly string[],
  isAdmin: boolean,
): Response | null {
  if (!isAdmin && scopes.includes("admin")) {
    return c.json(errorResponse("Admin scope requires an admin session"), 403);
  }
  return null;
}

export const tokensRouter = createHonoApp()
  .use("/*", withDualAuth())
  .get("/", zValidator("query", paginationQuerySchema), async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const { page, pageSize } = c.req.valid("query");
    const listResponse = GetTokensResponse.parse(
      await getUserApiTokens(user.userId, page, pageSize),
    );
    return c.json(listResponse);
  })
  .post("/", zValidator("json", createTokenSchema), async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const payload = c.req.valid("json");
    const adminScopeError = rejectNonAdminScope(
      c,
      payload.scopes,
      user.isAdmin,
    );
    if (adminScopeError) return adminScopeError;

    const created = await createApiToken(user.userId, payload);
    const createResponse = CreateTokenResponse.parse({
      token: {
        id: created.id,
        name: created.name,
        token: created.token,
        scopes: created.scopes,
        form_ids: created.formIds ?? null,
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

    if (!token) return c.json(errorResponse("Token not found"), 404);
    const parsedJson = parseStoredApiTokenJson(token, "tokens.get");
    if (!parsedJson) {
      return c.json(errorResponse("Stored token data is malformed"), 422);
    }

    const detailResponse = GetTokenResponse.parse({
      token: {
        id: token.id,
        name: token.name,
        scopes: parsedJson.scopes,
        form_ids: parsedJson.formIds ?? null,
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
    const [existing] = await db
      .select({
        id: apiToken.id,
        scopes: apiToken.scopes,
        formIds: apiToken.formIds,
      })
      .from(apiToken)
      .where(and(eq(apiToken.id, id), eq(apiToken.userId, user.userId)))
      .limit(1);

    if (!existing) return c.json(errorResponse("Token not found"), 404);

    const nextJson = parseStoredApiTokenJson(
      {
        id: existing.id,
        scopes: payload.scopes ?? existing.scopes,
        formIds: "form_ids" in payload ? payload.form_ids : existing.formIds,
      },
      "tokens.patch.preflight",
    );
    if (!nextJson) {
      return c.json(errorResponse("Stored token data is malformed"), 422);
    }
    const adminScopeError = rejectNonAdminScope(
      c,
      nextJson.scopes,
      user.isAdmin,
    );
    if (adminScopeError) return adminScopeError;

    const patch: {
      name?: string;
      scopes?: string[];
      formIds?: string[] | null;
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

    if (!updated) return c.json(errorResponse("Token not found"), 404);
    const parsedJson = parseStoredApiTokenJson(updated, "tokens.patch");
    if (!parsedJson) {
      return c.json(errorResponse("Stored token data is malformed"), 422);
    }

    const updateResponse = UpdateTokenResponse.parse({
      token: {
        id: updated.id,
        name: updated.name,
        scopes: parsedJson.scopes,
        form_ids: parsedJson.formIds ?? null,
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
      return c.json(errorResponse("Token not found or already deleted"), 404);
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
      return c.json(errorResponse("Token not found or already revoked"), 404);
    }
    return c.json(
      RevokeTokenResponse.parse({
        message: "API token revoked successfully",
      }),
    );
  })
  .post("/validate", zValidator("json", validateTokenSchema), async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const { token } = c.req.valid("json");
    let authContext: Awaited<ReturnType<typeof validateApiTokenForUser>>;
    try {
      authContext = await validateApiTokenForUser(token, user.userId, {
        updateLastUsedAt: false,
      });
    } catch (error) {
      if (error instanceof SuspendedTokenOwnerError) {
        return c.json(suspendedTokenOwnerErrorResponse(), 403);
      }
      throw error;
    }

    if (!authContext) {
      return c.json(ValidateTokenResponse.parse({ valid: false }), 401);
    }

    return c.json(
      ValidateTokenResponse.parse({
        valid: true,
        user_id: authContext.user_id,
        scopes: authContext.scopes,
      }),
    );
  });
