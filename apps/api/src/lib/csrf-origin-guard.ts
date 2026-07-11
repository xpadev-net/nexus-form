import type { MiddlewareHandler } from "hono";
import type { Env } from "./hono";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function normalizeHttpOrigin(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hasCookieHeader(cookieHeader: string | undefined): boolean {
  return Boolean(cookieHeader?.trim());
}

function isExcludedPath(path: string): boolean {
  return path === "/api/auth" || path.startsWith("/api/auth/");
}

export function createCsrfOriginGuard(
  allowedOrigins: readonly string[],
): MiddlewareHandler<Env> {
  const trustedOrigins = new Set(
    allowedOrigins
      .map((origin) => normalizeHttpOrigin(origin))
      .filter((origin): origin is string => origin !== null),
  );

  return async (c, next) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    if (isExcludedPath(c.req.path)) {
      await next();
      return;
    }

    if (!hasCookieHeader(c.req.header("cookie"))) {
      await next();
      return;
    }

    const origin = normalizeHttpOrigin(c.req.header("origin"));
    if (c.req.header("origin")) {
      if (origin && trustedOrigins.has(origin)) {
        await next();
        return;
      }
      return c.json({ error: "Forbidden" }, 403);
    }

    const refererOrigin = normalizeHttpOrigin(c.req.header("referer"));
    if (refererOrigin && trustedOrigins.has(refererOrigin)) {
      await next();
      return;
    }

    return c.json({ error: "Forbidden" }, 403);
  };
}
