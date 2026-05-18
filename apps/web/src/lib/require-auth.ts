import { isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

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
