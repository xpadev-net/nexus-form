import { useRouterState } from "@tanstack/react-router";
import { RouteErrorPanel } from "@/components/common/route-error-panel";
import { Footer } from "@/components/layout/footer";
import { Navigation } from "@/components/layout/navigation";
import { NavigationDrawer } from "@/components/layout/navigation-drawer";
import { usePageTitle } from "@/hooks/use-page-title";

type AuthenticatedRouteErrorPageProps = {
  error: unknown;
  reset: () => void;
};

export function AuthenticatedRouteErrorPage({
  error,
  reset,
}: AuthenticatedRouteErrorPageProps) {
  usePageTitle("エラーが発生しました");

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
          <RouteErrorPanel error={error} reset={reset} />
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
        <RouteErrorPanel error={error} reset={reset} />
      </main>
      <Footer />
    </div>
  );
}
