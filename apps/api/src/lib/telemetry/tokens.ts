import { createHash } from "node:crypto";
import { db } from "@nexus-form/database";
import { telemetryToken } from "@nexus-form/database/schema";
import type { InferSelectModel } from "drizzle-orm";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";

type TelemetryTokenRow = InferSelectModel<typeof telemetryToken>;

function getAffectedRows(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  const [header] = result;
  if (
    typeof header !== "object" ||
    header === null ||
    !("affectedRows" in header)
  ) {
    return 0;
  }
  const { affectedRows } = header;
  return typeof affectedRows === "number" ? affectedRows : 0;
}

function resolveTelemetryIpSalt(): string {
  const telemetrySalt = process.env.TELEMETRY_IP_SALT;
  if (telemetrySalt !== undefined && telemetrySalt !== "") return telemetrySalt;

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    throw new Error(
      "TELEMETRY_IP_SALT or AUTH_SECRET must be set for telemetry IP hashing",
    );
  }

  return createHash("sha256")
    .update(`telemetry-ip-salt:${authSecret}`)
    .digest("hex");
}

/**
 * Hashes a client IP address with the configured telemetry salt.
 *
 * @param ip - Normalized client IP address to hash.
 * @returns Stable salted hash used for telemetry token binding.
 */
export function hashIPAddress(ip: string): string {
  const salt = resolveTelemetryIpSalt();
  return createHash("sha256")
    .update(ip + salt)
    .digest("hex");
}

/**
 * Atomically consumes unused telemetry tokens bound to the current client IP.
 *
 * @param tokens - Telemetry token values submitted by the public form.
 * @param currentIp - Normalized client IP address observed during submission.
 * @returns Resolves when at least one token is valid, unused, unexpired, and IP-bound to currentIp.
 * Matching tokens authorize the submit; other submitted unused/unexpired candidates are consumed too.
 * @throws When no tokens are provided or no token is valid for the current IP.
 */
export async function consumeTokensOrThrow(
  tokens: string[],
  currentIp: string,
): Promise<void> {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) {
    throw new Error("No telemetry tokens provided");
  }

  // Mark current-IP matching unused tokens first; at least one match authorizes
  // the submit. v4/v6 tokens are alternative address-family evidence.
  const now = new Date();
  await db.transaction(async (tx) => {
    const result = await tx
      .update(telemetryToken)
      .set({ usedAt: now })
      .where(
        and(
          inArray(telemetryToken.token, unique),
          eq(telemetryToken.ip, hashIPAddress(currentIp)),
          isNull(telemetryToken.usedAt),
          gt(telemetryToken.expiresAt, now),
        ),
      );

    if (getAffectedRows(result) === 0) {
      throw new Error("Invalid, expired, or IP-mismatched telemetry tokens");
    }

    // Omit the IP predicate here so authorized dual-stack submits also burn
    // the submitted sibling token bound to the other address family.
    await tx
      .update(telemetryToken)
      .set({ usedAt: now })
      .where(
        and(
          inArray(telemetryToken.token, unique),
          isNull(telemetryToken.usedAt),
          gt(telemetryToken.expiresAt, now),
        ),
      );
  });
}

/**
 * Finds unused telemetry tokens that are still valid for the current client IP.
 *
 * @param tokens - Telemetry token values to look up.
 * @param currentIp - Normalized client IP address that must match the issued token binding.
 * @returns Matching unused and unexpired telemetry token rows for the supplied IP.
 */
export async function findTelemetryTokens(
  tokens: string[],
  currentIp: string,
): Promise<TelemetryTokenRow[]> {
  return db
    .select()
    .from(telemetryToken)
    .where(
      and(
        inArray(telemetryToken.token, tokens),
        eq(telemetryToken.ip, hashIPAddress(currentIp)),
        isNull(telemetryToken.usedAt),
        gt(telemetryToken.expiresAt, new Date()),
      ),
    );
}
