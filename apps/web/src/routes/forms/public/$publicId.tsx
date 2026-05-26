import { createFileRoute } from "@tanstack/react-router";
import { PublicRouteErrorPage } from "@/components/common/public-route-error-page";
import { PublicFormPage } from "@/components/forms/public-form-page";

export const Route = createFileRoute("/forms/public/$publicId")({
  component: PublicFormPage,
  errorComponent: PublicRouteErrorPage,
  validateSearch: (search): { p?: string } => {
    const p = search.p;
    if (typeof p === "string" && p.length > 0) return { p };
    return {};
  },
});
