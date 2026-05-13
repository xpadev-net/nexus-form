import { createFileRoute } from "@tanstack/react-router";
import { SharedFormPage } from "@/components/forms/shared-form-page";

export const Route = createFileRoute("/forms/shared/$token")({
  component: SharedFormPage,
});
