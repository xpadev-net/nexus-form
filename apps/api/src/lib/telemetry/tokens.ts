import { createHash } from "node:crypto";
import { db } from "@nexus-form/database";
import { telemetryToken } from "@nexus-form/database/schema";
import { and, gt, inArray, isNull } from "drizzle-orm";

export function hashIPAddress(ip: string): string {
  const salt =
    process.env.TELEMETRY_IP_SALT ??
    (() => {
      if (process.env.NODE_ENV === "production") {
        throw new Error("TELEMETRY_IP_SALT must be set in production");
      }
      return "default-salt-change-in-production";
    })();
  return createHash("sha256")
    .update(ip + salt)
    .digest("hex");
}

export async function consumeTokensOrThrow(tokens: string[]): Promise<void> {
  if (tokens.length === 0) {
    throw new Error("No telemetry tokens provided");
  }

  // Atomically mark all matching unused tokens as consumed in a single UPDATE.
  // The WHERE clause ensures only valid, unused, non-expired tokens are affected.
  const now = new Date();
  const result = await db
    .update(telemetryToken)
    .set({ usedAt: now })
    .where(
      and(
        inArray(telemetryToken.token, tokens),
        isNull(telemetryToken.usedAt),
        gt(telemetryToken.expiresAt, now),
      ),
    );

  // mysql2 returns [ResultSetHeader, FieldPacket[]] — check affected row count
  const header = result[0] as { affectedRows: number };
  if (header.affectedRows !== tokens.length) {
    throw new Error("Invalid or expired telemetry tokens");
  }
}

export async function findTelemetryTokens(tokens: string[]) {
  return db
    .select()
    .from(telemetryToken)
    .where(
      and(
        inArray(telemetryToken.token, tokens),
        isNull(telemetryToken.usedAt),
        gt(telemetryToken.expiresAt, new Date()),
      ),
    );
}
