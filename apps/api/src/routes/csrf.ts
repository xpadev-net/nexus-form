import { createHonoApp } from "../lib/hono";

export const csrfRouter = createHonoApp().get("/", (c) => {
  return c.json({
    token: "better-auth-managed",
    note: "CSRF is primarily managed by Better Auth and CORS policy.",
  });
});
