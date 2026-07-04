import { createFileRoute } from "@tanstack/react-router";
import { EditorRouteErrorPage } from "@/components/common/editor-route-error-page";
import { FormEditorPage } from "@/components/forms/form-editor-page";

export const Route = createFileRoute("/_authenticated/forms/$id/edit")({
  component: FormEditorPage,
  errorComponent: EditorRouteErrorPage,
  validateSearch: (search): { shareToken?: string; tab?: string } => {
    const tab = search.tab;
    const shareToken = search.shareToken;
    return {
      ...(typeof shareToken === "string" ? { shareToken } : {}),
      ...(typeof tab === "string" ? { tab } : {}),
    };
  },
});
