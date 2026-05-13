import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, form } from "@nexus-form/database";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";

const createFormSchema = z.object({
  title: z.string().min(1).max(255).default("Untitled Form"),
  description: z.string().max(5000).optional(),
});

export const formsRouter = createHonoApp()
  .use("*", withDualAuth())
  .get("/", async (c) => {
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    const forms = await db.query.form.findMany({
      where: eq(form.creatorId, auth.user_id),
      orderBy: [desc(form.updatedAt)],
    });
    return c.json({ forms });
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
    return c.json({ form: created }, 201);
  });
