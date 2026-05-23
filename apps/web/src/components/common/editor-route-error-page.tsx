import { RouteErrorPanel } from "@/components/common/route-error-panel";
import { NavigationDrawer } from "@/components/layout/navigation-drawer";
import { usePageTitle } from "@/hooks/use-page-title";

type EditorRouteErrorPageProps = {
  error: unknown;
  reset: () => void;
};

export function EditorRouteErrorPage({
  error,
  reset,
}: EditorRouteErrorPageProps) {
  usePageTitle("エラーが発生しました");

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
