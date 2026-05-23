import { createFileRoute } from "@tanstack/react-router";
import { PublicRouteErrorPage } from "@/components/common/public-route-error-page";
import { PublicFormPage } from "@/components/forms/public-form-page";

export const Route = createFileRoute("/forms/public/$publicId")({
  component: PublicFormPage,
  errorComponent: PublicRouteErrorPage,
});
