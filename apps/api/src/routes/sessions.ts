import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import { extractClientIP } from "../lib/ip-address";
import { createRateLimit } from "../lib/rate-limit";
import {
  extractJwtFromRequest,
  resolveSessionIdOrCreate,
} from "../lib/sessions/jwt";

export const sessionsRouter = createHonoApp()
  .use("/*", withDualAuth())
  .post(
    "/ensure",
    createRateLimit({ windowMs: 10 * 60 * 1000, maxRequests: 10 }),
    async (c) => {
      const jwtToken = extractJwtFromRequest(c);
      const { ip } = extractClientIP(c.req.raw, { strategy: "general" });
      const userAgent = c.req.header("user-agent") ?? undefined;

      const { jwt: newJwt } = await resolveSessionIdOrCreate(jwtToken, {
        ip,
        ua: userAgent,
      });

      c.header(
        "Set-Cookie",
        [
          `cf_session=${newJwt}`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          process.env.NODE_ENV === "production" ? "Secure" : null,
          "Max-Age=1209600",
        ]
          .filter(Boolean)
          .join("; "),
      );

      return c.json({ ok: true });
    },
  );
