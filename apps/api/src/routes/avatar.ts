import { createHonoApp } from "../lib/hono";

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

export const avatarRouter = createHonoApp().get("/:userId", (c) => {
  const userId = c.req.param("userId");
  if (!DISCORD_SNOWFLAKE.test(userId)) {
    return c.text("Invalid user ID", 400);
  }
  return c.redirect(`https://cdn.discordapp.com/avatars/${userId}`);
});
