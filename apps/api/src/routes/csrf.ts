import { z } from "zod";
import { createHonoApp } from "../lib/hono";

/**
 * CSRF token response containing the token string and a human-readable note for clients.
 * `CsrfResponse` is the inferred TypeScript type for this public response schema.
 */
export const CsrfResponseSchema = z.object({
  token: z.string(),
  note: z.string(),
});
/** Inferred TypeScript type for `CsrfResponseSchema`. */
export type CsrfResponse = z.infer<typeof CsrfResponseSchema>;

export const csrfRouter = createHonoApp().get("/", (c) => {
  return c.json(
    CsrfResponseSchema.parse({
      token: "better-auth-managed",
      note: "CSRF is primarily managed by Better Auth and CORS policy.",
    }),
  );
});
