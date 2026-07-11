import { createHash, createHmac, randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { formSession } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { TransactionClient } from "../forms/types";

const PASSWORD_GRANT_HMAC_DOMAIN = "nexus-form:public-form-password-grant:v2\0";

/** Runtime schema for one opaque, publication-bound V2 public-form grant. */
export const VerifiedFormGrantSchema = z.object({
  formId: z.string().min(1).max(255),
  revision: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** Runtime schema for session JWT claims, including read-only legacy claims. */
export const SessionJwtPayloadSchema = z.object({
  sessionId: z.string().min(1),
  // Read-only compatibility for tokens issued before V2. Protected forms
  // never authorize from this claim; unprotected forms do not inspect it.
  verifiedForms: z.array(z.string().min(1).max(255)).max(1000).optional(),
  verifiedFormGrants: z.array(VerifiedFormGrantSchema).max(1000).optional(),
});

export type VerifiedFormGrant = z.infer<typeof VerifiedFormGrantSchema>;

export type SessionJwtPayload = {
  sessionId: string;
  verifiedForms?: string[];
  verifiedFormGrants?: VerifiedFormGrant[];
};

export type PasswordGrantContext = {
  formId: string;
  publishedVersion: number;
  passwordHash: string;
};

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is required");
  return secret;
}

/**
 * Derives an opaque, publication-bound revision for a protected form.
 * AUTH_SECRET is deliberately part of the HMAC key: rotating it invalidates
 * all session JWTs and makes every password grant revision unusable as well.
 */
export function getPasswordGrantRevision(grant: PasswordGrantContext): string {
  return createHmac("sha256", getAuthSecret())
    .update(PASSWORD_GRANT_HMAC_DOMAIN)
    .update(
      JSON.stringify([
        grant.formId,
        grant.publishedVersion,
        grant.passwordHash,
      ]),
    )
    .digest("base64url");
}

/**
 * Signs a 14-day session JWT with optional V2 grants. When passwordGrant is
 * supplied, its opaque revision replaces any grant for the same form while
 * preserving grants for other forms; the raw password hash is never emitted.
 */
export function signSessionJwt(
  sessionId: string,
  additionalData?: {
    verifiedFormGrants?: VerifiedFormGrant[];
    passwordGrant?: PasswordGrantContext;
  },
): string {
  const secret = getAuthSecret();

  const payload: SessionJwtPayload = { sessionId };
  if (additionalData?.passwordGrant) {
    const { passwordGrant } = additionalData;
    const existingGrants = additionalData.verifiedFormGrants ?? [];
    payload.verifiedFormGrants = [
      ...existingGrants.filter(
        (grant) => grant.formId !== passwordGrant.formId,
      ),
      {
        formId: passwordGrant.formId,
        revision: getPasswordGrantRevision(passwordGrant),
      },
    ];
  } else if (additionalData?.verifiedFormGrants) {
    payload.verifiedFormGrants = additionalData.verifiedFormGrants;
  }

  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "14d" });
}

/**
 * Verifies a session JWT and runtime-validates its claims. Without
 * expectedPasswordGrant it returns the parsed session payload; when one is
 * supplied, it additionally requires the matching V2 grant and returns null
 * on a missing, stale, malformed, or legacy-only protected grant.
 */
export function verifySessionJwt(
  token: string,
  expectedPasswordGrant?: PasswordGrantContext,
): SessionJwtPayload | null {
  try {
    const decoded = jwt.verify(token, getAuthSecret(), {
      algorithms: ["HS256"],
    });
    const parsed = SessionJwtPayloadSchema.safeParse(decoded);
    if (!parsed.success) return null;

    if (expectedPasswordGrant) {
      const expectedRevision = getPasswordGrantRevision(expectedPasswordGrant);
      const hasExpectedGrant = parsed.data.verifiedFormGrants?.some(
        (grant) =>
          grant.formId === expectedPasswordGrant.formId &&
          grant.revision === expectedRevision,
      );
      if (!hasExpectedGrant) return null;
    }

    return parsed.data;
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
