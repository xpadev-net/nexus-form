import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { SignInSection } from "@/components/auth/signin-section";
import { useAuth } from "@/hooks/auth/use-auth";
import { DEFAULT_AUTH_REDIRECT } from "@/lib/auth-redirect";

export function SignInPage() {
  const { redirect } = useSearch({ from: "/login" });
  const { session } = useAuth();
  const redirectTo = redirect ?? DEFAULT_AUTH_REDIRECT;

  useEffect(() => {
    if (session.data?.session) {
      window.location.assign(redirectTo);
    }
  }, [redirectTo, session.data?.session]);

  if (session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="text-center">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <SignInSection callbackURL={redirectTo} />
    </div>
  );
}
