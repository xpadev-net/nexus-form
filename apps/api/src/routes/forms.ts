import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, form } from "@nexus-form/database";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
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

export const formsRouter = createHonoApp()
  .use("*", withDualAuth())
  .get("/", zValidator("query", formsListQuerySchema), async (c) => {
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    const { page, limit } = c.req.valid("query");
    const offset = (page - 1) * limit;

    const [totalResult, forms] = await Promise.all([
      db
        .select({ count: count() })
        .from(form)
        .where(eq(form.creatorId, auth.user_id)),
      db.query.form.findMany({
        where: eq(form.creatorId, auth.user_id),
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
  })
  .post("/", zValidator("json", createFormSchema), async (c) => {
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

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
  });
