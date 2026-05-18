import { createFileRoute } from "@tanstack/react-router";
import { FormPreviewPage } from "@/components/forms/form-preview-page";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/forms/preview/$id")({
  beforeLoad: requireAuth,
  component: FormPreviewPage,
});
