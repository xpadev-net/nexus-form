import { createFileRoute } from "@tanstack/react-router";
import { FormEditorPage } from "@/components/forms/form-editor-page";

export const Route = createFileRoute("/_authenticated/forms/$id/edit")({
  component: FormEditorPage,
  validateSearch: (search): { tab?: string } => {
    const tab = search.tab;
    if (typeof tab === "string") return { tab };
    return {};
  },
});
