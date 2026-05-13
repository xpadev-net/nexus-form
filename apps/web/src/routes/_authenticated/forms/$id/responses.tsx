import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/forms/$id/responses")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/forms/$id/edit",
      params: { id: params.id },
      search: { tab: "responses" },
    });
  },
});
