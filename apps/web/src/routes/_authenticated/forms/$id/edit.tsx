import { createFileRoute } from "@tanstack/react-router";
import { AuthenticatedRouteErrorPage } from "@/components/common/authenticated-route-error-page";
import { FormEditorPage } from "@/components/forms/form-editor-page";

export const Route = createFileRoute("/_authenticated/forms/$id/edit")({
  component: FormEditorPage,
  errorComponent: AuthenticatedRouteErrorPage,
  validateSearch: (search): { tab?: string } => {
    const tab = search.tab;
    if (typeof tab === "string") return { tab };
    return {};
  },
});
