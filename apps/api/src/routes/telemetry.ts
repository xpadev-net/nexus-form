import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { telemetryToken } from "@nexus-form/database/schema";
import { cors } from "hono/cors";
import { z } from "zod";
import { getCorsOrigins } from "../lib/cors-origins";
import { createHonoApp } from "../lib/hono";
import { extractClientIP } from "../lib/ip-address";
import { createRateLimit } from "../lib/rate-limit";
import { isFormSecurityBypassEnabled } from "../lib/security/form-security-bypass";
import { hashIPAddress } from "../lib/telemetry/tokens";

function issueToken(): string {
  return randomBytes(32).toString("hex");
}

async function issueTelemetryToken(ip: string, version: "V4" | "V6") {
  const token = issueToken();
  const ttl = Number.parseInt(process.env.TELEMETRY_TOKEN_TTL_SEC ?? "600", 10);
  const expiresAt = new Date(
    Date.now() + (Number.isNaN(ttl) || ttl <= 0 ? 600 : ttl) * 1000,
  );

  await db.insert(telemetryToken).values({
    id: randomUUID(),
    token,
    ip: hashIPAddress(ip),
    version,
    expiresAt,
  });

  return token;
}

const telemetryRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyGenerator: (c) => {
    const { ip } = extractClientIP(c.req.raw, { strategy: "telemetry" });
    return `telemetry:${ip}`;
  },
});

const TelemetryTokenResponseSchema = z.object({
  success: z.literal(true),
  token: z.string(),
  version: z.enum(["v4", "v6"]),
});
export type TelemetryTokenResponse = z.infer<
  typeof TelemetryTokenResponseSchema
>;

function developmentTelemetryToken(version: "v4" | "v6") {
  return TelemetryTokenResponseSchema.parse({
    success: true,
    token: `form-security-dev-bypass-${version}`,
    version,
  });
}

export const telemetryRouter = createHonoApp()
  .use(
    "*",
    cors({
      origin: getCorsOrigins(),
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  )
  .post("/v4", telemetryRateLimit, async (c) => {
    const { ip } = extractClientIP(c.req.raw, { strategy: "telemetry" });
    if (ip === "unknown") {
      if (isFormSecurityBypassEnabled()) {
        return c.json(developmentTelemetryToken("v4"));
      }

      return c.json(
        {
          success: false,
          error: "Unable to determine client IP",
          code: "IP_DETECTION_FAILED",
        },
        400,
      );
    }

    const token = await issueTelemetryToken(ip, "V4");
    return c.json(
      TelemetryTokenResponseSchema.parse({
        success: true,
        token,
        version: "v4",
      }),
    );
  })
  .post("/v6", telemetryRateLimit, async (c) => {
    const { ip } = extractClientIP(c.req.raw, { strategy: "telemetry" });
    if (ip === "unknown") {
      if (isFormSecurityBypassEnabled()) {
        return c.json(developmentTelemetryToken("v6"));
      }

      return c.json(
        {
          success: false,
          error: "Unable to determine client IP",
          code: "IP_DETECTION_FAILED",
        },
        400,
      );
    }

    const token = await issueTelemetryToken(ip, "V6");
    return c.json(
      TelemetryTokenResponseSchema.parse({
        success: true,
        token,
        version: "v6",
      }),
    );
  });
