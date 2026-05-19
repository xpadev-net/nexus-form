const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

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

export function warnIfProductionCorsOriginsEmpty(
  origins: readonly string[],
): void {
  if (process.env.NODE_ENV === "production" && origins.length === 0) {
    console.warn(
      "[cors] TRUSTED_ORIGINS is not set — all cross-origin requests will be blocked in production",
    );
  }
}
