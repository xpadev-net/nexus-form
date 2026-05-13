import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/use-auth";

type DiscordSignInButtonProps = {
  className?: string;
};

export const DiscordSignInButton = ({
  className,
}: DiscordSignInButtonProps) => {
  const { signInWithDiscord } = useAuth();

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void signInWithDiscord()}
      className={className}
    >
      Sign in with Discord
    </Button>
  );
};
