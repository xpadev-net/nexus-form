import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/use-auth";

export const SignOutButton = () => {
  const { signOut } = useAuth();
  return (
    <Button type="button" variant="outline" onClick={() => void signOut()}>
      Sign out
    </Button>
  );
};
