import { isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

/**
 * Ensures a user session exists for protected routes by calling
 * authClient.getSession, redirecting to /login through redirect when there is
 * no session, and rethrowing navigation redirects detected by isRedirect.
 *
 * @returns A promise that resolves when the current user is authenticated.
 * @throws Redirect when navigation to /login is performed.
 */
export async function requireAuth(): Promise<void> {
  try {
    const { data } = await authClient.getSession();
    if (!data?.session) {
      throw redirect({ to: "/login" });
    }
  } catch (error) {
    if (isRedirect(error)) throw error;
    throw redirect({ to: "/login" });
  }
}
