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

export const DISCORD_SIGN_IN_ERROR =
  "Discordへのサインインに失敗しました。もう一度お試しください。";

class DiscordSignInNetworkError extends TypeError {
  constructor(cause: unknown) {
    super(DISCORD_SIGN_IN_ERROR, { cause });
    this.name = "DiscordSignInNetworkError";
  }
}

function buildCallbackURL(callbackURL?: string): string {
  const path = sanitizeAuthRedirect(callbackURL) ?? DEFAULT_AUTH_REDIRECT;
  const normalizedBase = FRONTEND_BASE_URL.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

export const useAuth = () => {
  const session = authClient.useSession();

  const signInWithDiscord = async (
    callbackURL: string = DEFAULT_AUTH_REDIRECT,
  ): Promise<boolean> => {
    try {
      const result = await authClient.signIn.social({
        provider: "discord",
        callbackURL: buildCallbackURL(callbackURL),
      });

      if (result?.error) {
        throw new Error(DISCORD_SIGN_IN_ERROR, { cause: result.error });
      }

      return Boolean(result?.data?.redirect && result.data.url);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new DiscordSignInNetworkError(error);
      }

      if (error instanceof Error && error.message === DISCORD_SIGN_IN_ERROR) {
        throw error;
      }

      throw new Error(DISCORD_SIGN_IN_ERROR, { cause: error });
    }
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
