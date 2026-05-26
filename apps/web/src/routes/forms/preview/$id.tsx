import { createFileRoute } from "@tanstack/react-router";
import { FormPreviewPage } from "@/components/forms/form-preview-page";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/forms/preview/$id")({
  beforeLoad: requireAuth,
  component: FormPreviewPage,
  validateSearch: (search): { p?: string } => {
    const p = search.p;
    if (typeof p === "string" && p.length > 0) return { p };
    return {};
  },
});
