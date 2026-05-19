import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { NotFoundPage } from "@/components/common/not-found-page";
import { RootErrorPage } from "@/components/common/root-error-page";

export const Route = createRootRoute({
  notFoundComponent: NotFoundPage,
  errorComponent: RootErrorPage,
  component: () => (
    <>
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </>
  ),
});
