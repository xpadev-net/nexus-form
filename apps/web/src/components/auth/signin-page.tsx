import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SignInSection } from "@/components/auth/signin-section";
import { useAuth } from "@/hooks/auth/use-auth";

export function SignInPage() {
  const navigate = useNavigate();
  const { session } = useAuth();

  useEffect(() => {
    if (session.data?.session) {
      void navigate({ to: "/" });
    }
  }, [navigate, session.data?.session]);

  if (session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="text-center">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <SignInSection />
    </div>
  );
}
