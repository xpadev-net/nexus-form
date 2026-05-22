import { authClient } from "@/lib/auth-client";
import { DEFAULT_AUTH_REDIRECT } from "@/lib/auth-redirect";

export const useAuth = () => {
  const session = authClient.useSession();

  const signInWithDiscord = async (
    callbackURL: string = DEFAULT_AUTH_REDIRECT,
  ) => {
    await authClient.signIn.social({
      provider: "discord",
      callbackURL,
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
