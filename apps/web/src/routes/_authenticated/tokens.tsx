import { createFileRoute } from "@tanstack/react-router";
import { TokensPage } from "@/components/tokens/tokens-page";

export const Route = createFileRoute("/_authenticated/tokens")({
  component: TokensPage,
});
