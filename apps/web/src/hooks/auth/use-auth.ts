import { authClient } from "@/lib/auth-client";

export const useAuth = () => {
  const session = authClient.useSession();

  const signInWithDiscord = async () => {
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: "/",
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
