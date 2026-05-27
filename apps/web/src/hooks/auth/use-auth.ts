import { authClient } from "@/lib/auth-client";
import {
  DEFAULT_AUTH_REDIRECT,
  sanitizeAuthRedirect,
} from "@/lib/auth-redirect";
import { getRuntimeConfigValue } from "@/lib/runtime-config";

const fallbackBaseUrl =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost:3000";

const FRONTEND_BASE_URL = (() => {
  const rawFrontendBaseUrl = getRuntimeConfigValue(
    "baseUrl",
    import.meta.env.VITE_BASE_URL,
    fallbackBaseUrl,
  );

  try {
    const parsedBaseUrl = new URL(rawFrontendBaseUrl);
    const normalizedBasePath = parsedBaseUrl.pathname.replace(/\/+$/, "");
    return `${parsedBaseUrl.origin}${normalizedBasePath}`;
  } catch {
    return fallbackBaseUrl;
  }
})();

function buildCallbackURL(callbackURL?: string): string {
  const path = sanitizeAuthRedirect(callbackURL) ?? DEFAULT_AUTH_REDIRECT;
  const normalizedBase = FRONTEND_BASE_URL.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

export const useAuth = () => {
  const session = authClient.useSession();

  const signInWithDiscord = async (
    callbackURL: string = DEFAULT_AUTH_REDIRECT,
  ) => {
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: buildCallbackURL(callbackURL),
    });
  };

  const signOut = async () => {
    await authClient.signOut();
  };

  return {
    session,
    signInWithDiscord,
    signOut,
  };
};
