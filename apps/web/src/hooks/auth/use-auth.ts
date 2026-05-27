import { authClient } from "@/lib/auth-client";
import {
  DEFAULT_AUTH_REDIRECT,
  sanitizeAuthRedirect,
} from "@/lib/auth-redirect";
import { getRuntimeConfigValue } from "@/lib/runtime-config";

function buildCallbackURL(callbackURL?: string): string {
  const fallbackBaseUrl =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:3000";

  let frontendBaseUrl = getRuntimeConfigValue(
    "baseUrl",
    import.meta.env.VITE_BASE_URL,
    fallbackBaseUrl,
  );

  try {
    const parsedBaseUrl = new URL(frontendBaseUrl);
    const normalizedBasePath = parsedBaseUrl.pathname.replace(/\/+$/, "");
    frontendBaseUrl = `${parsedBaseUrl.origin}${normalizedBasePath}`;
  } catch {
    frontendBaseUrl = fallbackBaseUrl;
  }

  const path = sanitizeAuthRedirect(callbackURL) ?? DEFAULT_AUTH_REDIRECT;
  const normalizedBase = frontendBaseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

async function signInWithDiscord(callbackURL: string = DEFAULT_AUTH_REDIRECT) {
  await authClient.signIn.social({
    provider: "discord",
    callbackURL: buildCallbackURL(callbackURL),
  });
}

async function signOut() {
  await authClient.signOut();
}

export const getSignInActions = () => ({
  signInWithDiscord,
});

export const useAuth = () => {
  const session = authClient.useSession();

  return {
    session,
    signInWithDiscord,
    signOut,
  };
};
