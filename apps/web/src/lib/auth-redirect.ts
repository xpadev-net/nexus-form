export const DEFAULT_AUTH_REDIRECT = "/";

const AUTH_REDIRECT_BASE_URL = "https://nexus-form.local";
const MAX_AUTH_REDIRECT_LENGTH = 2048;

export function sanitizeAuthRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > MAX_AUTH_REDIRECT_LENGTH) {
    return undefined;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;

  try {
    const url = new URL(value, AUTH_REDIRECT_BASE_URL);
    if (url.origin !== AUTH_REDIRECT_BASE_URL) return undefined;

    const target = `${url.pathname}${url.search}${url.hash}`;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
      return undefined;
    }
    return target;
  } catch {
    return undefined;
  }
}

export function getAuthRedirect(value: unknown): string {
  return sanitizeAuthRedirect(value) ?? DEFAULT_AUTH_REDIRECT;
}
