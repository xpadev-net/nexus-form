import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DISCORD_SIGN_IN_ERROR, useAuth } from "@/hooks/auth/use-auth";

type DiscordSignInButtonProps = {
  callbackURL?: string;
  className?: string;
};

export const DiscordSignInButton = ({
  callbackURL,
  className,
}: DiscordSignInButtonProps) => {
  const { signInWithDiscord } = useAuth();
  const signInAttemptRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (signInAttemptRef.current || isSigningIn) return;

    signInAttemptRef.current = true;
    setIsSigningIn(true);
    setSignInError(null);
    let handoffStarted = false;
    try {
      await signInWithDiscord(callbackURL);
      handoffStarted = true;
    } catch {
      setSignInError(DISCORD_SIGN_IN_ERROR);
    } finally {
      if (!handoffStarted) {
        signInAttemptRef.current = false;
        setIsSigningIn(false);
      }
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleSignIn()}
        className={className}
        disabled={isSigningIn}
        aria-busy={isSigningIn}
        aria-describedby={signInError ? "discord-sign-in-error" : undefined}
      >
        {isSigningIn ? "Signing in..." : "Sign in with Discord"}
      </Button>
      {signInError ? (
        <p
          id="discord-sign-in-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {signInError}
        </p>
      ) : null}
    </div>
  );
};
