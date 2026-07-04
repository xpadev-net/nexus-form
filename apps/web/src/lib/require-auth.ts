import { isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { sanitizeAuthRedirect } from "@/lib/auth-redirect";

type RequireAuthContext = {
  location?: {
    href: string;
  };
};

function isShareLinkEditorUrl(location: RequireAuthContext["location"]) {
  if (!location?.href) return false;
  const url = new URL(location.href, "http://localhost");
  return (
    /^\/forms\/[^/]+\/edit$/.test(url.pathname) &&
    Boolean(url.searchParams.get("shareToken"))
  );
}

function loginRedirectFor(location: RequireAuthContext["location"]) {
  return redirect({
    to: "/login",
    search: {
      redirect: sanitizeAuthRedirect(location?.href),
    },
  });
}

/**
 * Ensures a user session exists for protected routes by calling
 * authClient.getSession, redirecting to /login through redirect when there is
 * no session, and rethrowing navigation redirects detected by isRedirect.
 *
 * @returns A promise that resolves when the current user is authenticated.
 * @throws Redirect when navigation to /login is performed.
 */
export async function requireAuth({
  location,
}: RequireAuthContext = {}): Promise<void> {
  if (isShareLinkEditorUrl(location)) return;

  try {
    const { data } = await authClient.getSession();
    if (!data?.session) {
      throw loginRedirectFor(location);
    }
  } catch (error) {
    if (isRedirect(error)) throw error;
    throw loginRedirectFor(location);
  }
}
