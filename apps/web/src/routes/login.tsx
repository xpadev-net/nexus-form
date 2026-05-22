import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "@/components/auth/signin-page";
import { sanitizeAuthRedirect } from "@/lib/auth-redirect";

export const Route = createFileRoute("/login")({
  component: SignInPage,
  validateSearch: (search): { redirect?: string } => {
    const redirect = sanitizeAuthRedirect(search.redirect);
    return redirect ? { redirect } : {};
  },
});
