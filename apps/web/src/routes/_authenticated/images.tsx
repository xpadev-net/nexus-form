import { createFileRoute } from "@tanstack/react-router";
import { ImagesPage } from "@/components/images/images-page";

export const Route = createFileRoute("/_authenticated/images")({
  component: ImagesPage,
});
