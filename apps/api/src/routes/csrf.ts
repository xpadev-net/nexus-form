import { z } from "zod";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";

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

const csrfRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyGenerator: (c) => `rate_limit:csrf:ip:${getClientIp(c)}`,
});

export const csrfRouter = createHonoApp().get("/", csrfRateLimit, (c) => {
  return c.json(
    CsrfResponseSchema.parse({
      token: "better-auth-managed",
      note: "CSRF is primarily managed by Better Auth and CORS policy.",
    }),
  );
});
