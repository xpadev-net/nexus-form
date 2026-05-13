import { createHonoApp } from "../lib/hono";

export const avatarRouter = createHonoApp().get("/:userId", (c) => {
  const userId = c.req.param("userId");
  return c.redirect(`https://cdn.discordapp.com/avatars/${userId}`);
});
