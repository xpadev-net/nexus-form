import { createFileRoute, redirect } from "@tanstack/react-router";
import { FormPreviewPage } from "@/components/forms/form-preview-page";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/forms/preview/$id")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data?.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: FormPreviewPage,
});
