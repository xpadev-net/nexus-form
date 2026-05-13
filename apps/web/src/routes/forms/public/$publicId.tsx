import { createFileRoute } from "@tanstack/react-router";
import { PublicFormPage } from "@/components/forms/public-form-page";

export const Route = createFileRoute("/forms/public/$publicId")({
  component: PublicFormPage,
});
