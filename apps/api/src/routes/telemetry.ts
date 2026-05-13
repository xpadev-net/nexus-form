import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { telemetryToken } from "@nexus-form/database/schema";
import { cors } from "hono/cors";
import { createHonoApp } from "../lib/hono";
import { extractClientIP } from "../lib/ip-address";
import { createRateLimit } from "../lib/rate-limit";
import { hashIPAddress } from "../lib/telemetry/tokens";

function getCorsOrigins(): string[] {
  const origins: string[] = ["http://localhost:3000"];
  const trusted = process.env.TRUSTED_ORIGINS;
  if (trusted) {
    for (const origin of trusted.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }
  return [...new Set(origins)];
}

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
    return c.json({ success: true, token, version: "v4" });
  })
  .post("/v6", telemetryRateLimit, async (c) => {
    const { ip } = extractClientIP(c.req.raw, { strategy: "telemetry" });
    if (ip === "unknown") {
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
    return c.json({ success: true, token, version: "v6" });
  });
