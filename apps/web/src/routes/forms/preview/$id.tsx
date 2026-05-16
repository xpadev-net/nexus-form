import { createFileRoute, redirect } from "@tanstack/react-router";
import { FormPreviewPage } from "@/components/forms/form-preview-page";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/forms/preview/$id")({
  beforeLoad: async () => {
    try {
      const { data } = await authClient.getSession();
      if (!data?.session) {
        throw redirect({ to: "/login" });
      }
    } catch (error) {
      if (error && typeof error === "object" && "to" in error) throw error;
      throw redirect({ to: "/login" });
    }
  },
  component: FormPreviewPage,
});
