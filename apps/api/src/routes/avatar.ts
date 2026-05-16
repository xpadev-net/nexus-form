import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHonoApp } from "../lib/hono";

const avatarParamsSchema = z.object({
  userId: z.string().regex(/^\d{17,20}$/, "Invalid Discord user ID"),
});

export const avatarRouter = createHonoApp().get(
  "/:userId",
  zValidator("param", avatarParamsSchema),
  (c) => {
    const { userId } = c.req.valid("param");
    return c.redirect(`https://cdn.discordapp.com/avatars/${userId}`);
  },
);
