import { RouteErrorPanel } from "@/components/common/route-error-panel";
import { Footer } from "@/components/layout/footer";
import { Navigation } from "@/components/layout/navigation";
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
