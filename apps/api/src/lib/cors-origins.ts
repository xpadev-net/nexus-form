const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

/**
 * Builds the allowed CORS origin list from the runtime environment.
 *
 * @returns A string array of allowed origins.
 *
 * Uses `NODE_ENV` to include the local development origin in `development`
 * and `test`, then splits and trims comma-separated `TRUSTED_ORIGINS` values.
 * Empty entries are ignored and duplicates are removed through a `Set`.
 */
export function getCorsOrigins(): string[] {
  const origins: string[] =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? [LOCAL_DEVELOPMENT_ORIGIN]
      : [];
  const trustedOrigins = process.env.TRUSTED_ORIGINS;
  if (trustedOrigins) {
    for (const origin of trustedOrigins.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }
  return [...new Set(origins)];
}

/**
 * Emits a production-only warning when no valid CORS origins are configured.
 *
 * @param origins - The readonly list of allowed CORS origins.
 * @returns void
 *
 * Side effect: calls `console.warn` when `NODE_ENV` is `production` and
 * `origins` is empty, indicating that no valid `TRUSTED_ORIGINS` are active.
 */
export function warnIfProductionCorsOriginsEmpty(
  origins: readonly string[],
): void {
  if (process.env.NODE_ENV === "production" && origins.length === 0) {
    console.warn(
      "[cors] No valid TRUSTED_ORIGINS configured — all cross-origin requests will be blocked in production",
    );
  }
}
