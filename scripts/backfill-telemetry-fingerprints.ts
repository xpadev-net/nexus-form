import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

interface FormResponseRow extends mysql.RowDataPacket {
  id: string;
  formId: string;
  submittedAt: Date;
  sessionId: string | null;
}

interface TelemetryTokenRow extends mysql.RowDataPacket {
  id: string;
  ip: string;
  version: "V4" | "V6";
  usedAt: Date;
}

interface ExistingFingerprintRow extends mysql.RowDataPacket {
  responseId: string;
  componentName: string;
  componentValueHash: string;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is required.");
    console.error("Usage: DATABASE_URL=\"mysql://user:pass@host:port/dbname\" npx tsx backfill-telemetry-fingerprints.ts [--dry-run]");
    process.exit(1);
  }

  const isDryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
  const toleranceSeconds = Number(process.env.TOLERANCE_SECONDS || "30");

  console.log(`Starting telemetry fingerprint backfill with 1-to-1 unique token matching...`);
  console.log(`Mode: ${isDryRun ? "DRY-RUN (No DB modifications)" : "LIVE (DB WILL BE UPDATED)"}`);
  console.log(`Time tolerance: +/- ${toleranceSeconds} seconds`);

  const connection = await mysql.createConnection(databaseUrl);

  try {
    // 1. Fetch FormResponses ordered by submission time
    const [responses] = await connection.query<FormResponseRow[]>(
      `SELECT id, formId, submittedAt, sessionId FROM FormResponse ORDER BY submittedAt ASC`
    );

    console.log(`Found ${responses.length} total FormResponse(s).`);

    // 2. Fetch existing telemetry fingerprint details
    const [existingDetails] = await connection.query<ExistingFingerprintRow[]>(
      `SELECT responseId, componentName, componentValueHash FROM FingerprintDetail WHERE fingerprintType = 'telemetry'`
    );

    const existingMap = new Set<string>();
    const usedTokenIps = new Set<string>();

    for (const row of existingDetails) {
      existingMap.add(`${row.responseId}:${row.componentName.toLowerCase()}`);
      if (row.componentValueHash) {
        usedTokenIps.add(`${row.componentName.toLowerCase()}:${row.componentValueHash}`);
      }
    }

    // Clear existing backfilled telemetry records if requested to do a clean re-backfill
    const isCleanRebackfill = process.argv.includes("--clean-rebackfill");
    if (isCleanRebackfill && !isDryRun) {
      console.log(`[CLEAN RE-BACKFILL] Deleting legacy backfilled telemetry records...`);
      await connection.query(`DELETE FROM FingerprintDetail WHERE fingerprintType = 'telemetry'`);
      existingMap.clear();
      usedTokenIps.clear();
    }

    // 3. Fetch all TelemetryTokens sorted by usedAt
    const [allTokens] = await connection.query<TelemetryTokenRow[]>(
      `SELECT id, ip, telemetry_version AS version, usedAt FROM TelemetryToken
       WHERE usedAt IS NOT NULL ORDER BY usedAt ASC`
    );

    // Track assigned token IDs so one TelemetryToken is used AT MOST ONCE
    const assignedTokenIds = new Set<string>();

    let restoredV4Count = 0;
    let restoredV6Count = 0;
    let skippedResponses = 0;
    let unmatchedResponses = 0;

    for (const response of responses) {
      const submittedAtTime = new Date(response.submittedAt).getTime();
      const hasV4 = existingMap.has(`${response.id}:v4`);
      const hasV6 = existingMap.has(`${response.id}:v6`);

      if (hasV4 && hasV6) {
        skippedResponses++;
        continue;
      }

      // Filter available tokens within tolerance window that have NOT been assigned yet
      const candidateTokens = allTokens.filter((token) => {
        if (assignedTokenIds.has(token.id)) return false;
        const usedAtTime = new Date(token.usedAt).getTime();
        const diff = Math.abs(usedAtTime - submittedAtTime);
        return diff <= toleranceSeconds * 1000;
      });

      let bestV4: TelemetryTokenRow | null = null;
      let bestV4Diff = Infinity;
      let bestV6: TelemetryTokenRow | null = null;
      let bestV6Diff = Infinity;

      for (const token of candidateTokens) {
        const usedAtTime = new Date(token.usedAt).getTime();
        const diff = Math.abs(usedAtTime - submittedAtTime);

        if (token.version === "V4" && !hasV4) {
          if (diff < bestV4Diff) {
            bestV4Diff = diff;
            bestV4 = token;
          }
        } else if (token.version === "V6" && !hasV6) {
          if (diff < bestV6Diff) {
            bestV6Diff = diff;
            bestV6 = token;
          }
        }
      }

      const toInsert: Array<{ componentName: "v4" | "v6"; token: TelemetryTokenRow }> = [];

      if (!hasV4 && bestV4) {
        toInsert.push({ componentName: "v4", token: bestV4 });
        assignedTokenIds.add(bestV4.id);
      }
      if (!hasV6 && bestV6) {
        toInsert.push({ componentName: "v6", token: bestV6 });
        assignedTokenIds.add(bestV6.id);
      }

      if (toInsert.length === 0) {
        unmatchedResponses++;
        console.log(
          `[WARN] No unassigned TelemetryToken found for response ID ${response.id} (submittedAt: ${response.submittedAt.toISOString()})`
        );
        continue;
      }

      for (const item of toInsert) {
        console.log(
          `[MATCH] Response ${response.id} -> ${item.componentName.toUpperCase()} IP hash ${item.token.ip.substring(
            0,
            16
          )}... (diff: ${Math.abs(new Date(item.token.usedAt).getTime() - submittedAtTime)}ms)`
        );

        if (!isDryRun) {
          await connection.query(
            `INSERT INTO FingerprintDetail
             (id, responseId, fingerprintType, componentName, componentValue, componentValueHash, collectedAt)
             VALUES (?, ?, 'telemetry', ?, '', ?, ?)
             ON DUPLICATE KEY UPDATE componentValueHash = VALUES(componentValueHash)`,
            [
              randomUUID(),
              response.id,
              item.componentName,
              item.token.ip,
              item.token.usedAt,
            ]
          );
        }

        if (item.componentName === "v4") restoredV4Count++;
        if (item.componentName === "v6") restoredV6Count++;
      }
    }

    console.log("\n================ Backfill Summary ================");
    console.log(`Total Responses Evaluated: ${responses.length}`);
    console.log(`Already complete (skipped): ${skippedResponses}`);
    console.log(`Restored v4 components:   ${restoredV4Count}`);
    console.log(`Restored v6 components:   ${restoredV6Count}`);
    console.log(`Unmatched (no token):     ${unmatchedResponses}`);
    console.log(
      `Execution Mode:           ${isDryRun ? "DRY-RUN (No changes saved)" : "LIVE (Successfully updated DB)"}`
    );
    console.log("==================================================");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed with error:", err);
  process.exit(1);
});
