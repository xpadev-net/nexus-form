import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/use-auth";

type DiscordSignInButtonProps = {
  callbackURL?: string;
  className?: string;
};

export const DiscordSignInButton = ({
  callbackURL,
  className,
}: DiscordSignInButtonProps) => {
  const { signInWithDiscord } = useAuth();

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void signInWithDiscord(callbackURL)}
      className={className}
    >
      Sign in with Discord
    </Button>
  );
};
