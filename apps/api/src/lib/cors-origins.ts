const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

type TrustedOriginsParseResult = {
  origins: string[];
  invalidCount: number;
};

function normalizeHttpOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname.includes("*") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parseTrustedOrigins(
  trustedOrigins: string | undefined,
): TrustedOriginsParseResult {
  if (trustedOrigins === undefined) {
    return { origins: [], invalidCount: 0 };
  }

  const origins: string[] = [];
  let invalidCount = 0;
  for (const origin of trustedOrigins.split(",")) {
    const normalized = normalizeHttpOrigin(origin);
    if (normalized) {
      origins.push(normalized);
    } else {
      invalidCount += 1;
    }
  }

  return {
    origins: [...new Set(origins)],
    invalidCount,
  };
}

/**
 * Builds the allowed CORS origin list from the runtime environment.
 *
 * @returns A string array of allowed origins.
 *
 * Uses `NODE_ENV` to include the local development origin in `development`
 * and `test`, then parses comma-separated `TRUSTED_ORIGINS` values as
 * HTTP(S) origins. Empty or invalid values are ignored outside production;
 * production startup rejects them through `assertProductionCorsOriginsConfigured`.
 */
export function getCorsOrigins(): string[] {
  const origins: string[] =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? [LOCAL_DEVELOPMENT_ORIGIN]
      : [];
  origins.push(...parseTrustedOrigins(process.env.TRUSTED_ORIGINS).origins);
  return [...new Set(origins)];
}

/**
 * Fails production startup when TRUSTED_ORIGINS is missing or malformed.
 *
 * @returns void
 *
 * This is called while constructing the exported app so direct entrypoints
 * and import-based serving adapters share the same fail-closed behavior.
 */
export function assertProductionCorsOriginsConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;

  const { origins, invalidCount } = parseTrustedOrigins(
    process.env.TRUSTED_ORIGINS,
  );
  if (origins.length === 0 || invalidCount > 0) {
    throw new Error(
      "TRUSTED_ORIGINS must contain one or more valid HTTP(S) origins in production",
    );
  }
}
