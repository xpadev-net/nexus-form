import { z } from "zod";
import { createHonoApp } from "../lib/hono";

export const CsrfResponseSchema = z.object({
  token: z.string(),
  note: z.string(),
});
export type CsrfResponse = z.infer<typeof CsrfResponseSchema>;

export const csrfRouter = createHonoApp().get("/", (c) => {
  return c.json(
    CsrfResponseSchema.parse({
      token: "better-auth-managed",
      note: "CSRF is primarily managed by Better Auth and CORS policy.",
    }),
  );
});
