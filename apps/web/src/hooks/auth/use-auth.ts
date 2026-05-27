import { authClient } from "@/lib/auth-client";
import {
  DEFAULT_AUTH_REDIRECT,
  sanitizeAuthRedirect,
} from "@/lib/auth-redirect";
import { getRuntimeConfigValue } from "@/lib/runtime-config";

function buildCallbackURL(callbackURL?: string): string {
  const frontendBaseUrl = getRuntimeConfigValue(
    "baseUrl",
    import.meta.env.VITE_BASE_URL,
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:3000",
  );

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

export const useSignIn = () => ({
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
