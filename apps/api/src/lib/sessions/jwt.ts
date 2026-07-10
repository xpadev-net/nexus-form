import { createHash, randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { formSession } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import jwt from "jsonwebtoken";
import type { TransactionClient } from "../forms/types";

export type SessionJwtPayload = {
  sessionId: string;
  verifiedForms?: string[];
};

export function signSessionJwt(
  sessionId: string,
  additionalData?: { verifiedForms?: string[] },
): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is required");

  const payload: SessionJwtPayload = { sessionId };
  if (additionalData?.verifiedForms) {
    payload.verifiedForms = additionalData.verifiedForms;
  }

  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "14d" });
}

export function verifySessionJwt(token: string): SessionJwtPayload | null {
  try {
    const secret = process.env.AUTH_SECRET;
    if (!secret)
      throw new Error("AUTH_SECRET environment variable is required");
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "sessionId" in decoded &&
      typeof decoded.sessionId === "string"
    ) {
      return decoded as SessionJwtPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractJwtFromRequest(c: Context): string | null {
  const cookieHeader = c.req.header("cookie") ?? "";
  const cookieToken = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("cf_session="))
    ?.split("=")[1];
  if (cookieToken) return cookieToken;

  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  return null;
}

export function hashIp(ip: string): string | null {
  if (!ip) return null;

  const sessionIpSalt = process.env.SESSION_IP_SALT;
  let salt = sessionIpSalt;
  if (!salt) {
    const authSecret = process.env.AUTH_SECRET;
    if (!authSecret) {
      throw new Error(
        "AUTH_SECRET environment variable is required for IP hashing",
      );
    }
    salt = createHash("sha256").update(`ip-salt:${authSecret}`).digest("hex");
  }

  return createHash("sha256").update(`${ip}:${salt}`).digest("hex");
}

export async function resolveSessionIdOrCreate(
  jwtToken: string | null,
  meta: { ip?: string; ua?: string },
  executor: TransactionClient | typeof db = db,
): Promise<{ sessionId: string; jwt: string }> {
  if (jwtToken) {
    const decoded = verifySessionJwt(jwtToken);
    if (decoded) {
      const [session] = await executor
        .select({ id: formSession.id })
        .from(formSession)
        .where(eq(formSession.id, decoded.sessionId))
        .limit(1);

      if (session) {
        await executor
          .update(formSession)
          .set({ lastSeenAt: new Date() })
          .where(eq(formSession.id, decoded.sessionId));
        return { sessionId: decoded.sessionId, jwt: jwtToken };
      }
    }
  }

  const id = randomUUID();
  await executor.insert(formSession).values({
    id,
    ipHash: meta.ip ? hashIp(meta.ip) : null,
    userAgent: meta.ua ?? null,
  });
  return { sessionId: id, jwt: signSessionJwt(id) };
}
