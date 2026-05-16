import {
  createFileRoute,
  isRedirect,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Footer } from "@/components/layout/footer";
import { Navigation } from "@/components/layout/navigation";
import { NavigationDrawer } from "@/components/layout/navigation-drawer";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    try {
      const { data } = await authClient.getSession();
      if (!data?.session) {
        throw redirect({ to: "/login" });
      }
    } catch (error) {
      if (isRedirect(error)) throw error;
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isEditorPage = /^\/forms\/[^/]+\/edit$/.test(pathname);

  if (isEditorPage) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex items-center px-3 py-1">
          <NavigationDrawer />
        </header>
        <main className="px-6 pb-6">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-4">
        <Navigation />
      </header>
      <main className="p-6">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
