import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, form } from "@nexus-form/database";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { type DualAuthContext, withDualAuth } from "../lib/dual-auth";
import { createHonoApp, type Env } from "../lib/hono";
import type { TokenScope } from "../types/api/auth";
import { errorResponse } from "../types/domain/common";
import {
  FormCreateResponseSchema,
  FormsListResponseSchema,
} from "../types/domain/form-row";

const createFormSchema = z.object({
  title: z.string().min(1).max(255).default("Untitled Form"),
  description: z.string().max(5000).optional(),
});

const formsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function createFormsListWhere(auth: DualAuthContext) {
  const ownerFilter = eq(form.creatorId, auth.user_id);
  if (auth.auth_type === "api_token" && auth.form_ids) {
    if (auth.form_ids.length === 0) {
      return and(ownerFilter, sql`1 = 0`);
    }
    return and(ownerFilter, inArray(form.id, auth.form_ids));
  }
  return ownerFilter;
}

const requireFormCreationAuth = createMiddleware<Env>(async (c, next) => {
  const auth = c.get("dualAuthContext");
  if (!auth) return c.json(errorResponse("Unauthorized"), 401);
  if (auth.auth_type === "api_token") {
    const scopes = auth.scopes ?? [];
    if (
      !scopes.includes("write" as TokenScope) &&
      !scopes.includes("admin" as TokenScope)
    ) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }
    if (auth.form_ids) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }
  }
  return next();
});

export const formsRouter = createHonoApp()
  .get(
    "/",
    withDualAuth(),
    zValidator("query", formsListQuerySchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);

      const { page, limit } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const formsListWhere = createFormsListWhere(auth);

      const [totalResult, forms] = await Promise.all([
        db.select({ count: count() }).from(form).where(formsListWhere),
        db.query.form.findMany({
          where: formsListWhere,
          orderBy: [desc(form.updatedAt)],
          limit,
          offset,
        }),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const response = FormsListResponseSchema.parse({
        forms,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
      return c.json(response);
    },
  )
  .post(
    "/",
    withDualAuth(),
    requireFormCreationAuth,
    zValidator("json", createFormSchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(errorResponse("Unauthorized"), 401);

      const payload = c.req.valid("json");
      const id = randomUUID();
      const publicId = randomUUID();
      await db.insert(form).values({
        id,
        creatorId: auth.user_id,
        title: payload.title,
        description: payload.description ?? null,
        publicId,
        status: "DRAFT",
      });

      const [created] = await db
        .select()
        .from(form)
        .where(eq(form.id, id))
        .limit(1);
      const response = FormCreateResponseSchema.parse({ form: created });
      return c.json(response, 201);
    },
  )
  .delete("/:id/blocks/sessions/:sessionId", withDualAuth(), (c) =>
    c.json(errorResponse("Not found"), 404),
  )
  .delete("/:id/blocks/sessions", withDualAuth(), (c) =>
    c.json(errorResponse("Not found"), 404),
  );
