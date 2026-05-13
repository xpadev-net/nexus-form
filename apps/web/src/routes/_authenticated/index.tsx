import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/forms/dashboard-page";

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
});
