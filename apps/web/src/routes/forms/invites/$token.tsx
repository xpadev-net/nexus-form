import { createFileRoute } from "@tanstack/react-router";
import { InviteAcceptancePage } from "@/components/forms/invite-acceptance-page";

export const Route = createFileRoute("/forms/invites/$token")({
  component: InviteAcceptancePage,
});
