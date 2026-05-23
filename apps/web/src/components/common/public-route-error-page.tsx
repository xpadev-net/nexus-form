import { RouteErrorPanel } from "@/components/common/route-error-panel";
import { usePageTitle } from "@/hooks/use-page-title";

type PublicRouteErrorPageProps = {
  error: unknown;
  reset: () => void;
};

export function PublicRouteErrorPage({
  error,
  reset,
}: PublicRouteErrorPageProps) {
  usePageTitle("エラーが発生しました");

  return (
    <div className="min-h-screen bg-background px-4 py-12 text-foreground">
      <main className="mx-auto w-full max-w-lg">
        <RouteErrorPanel error={error} reset={reset} />
      </main>
    </div>
  );
}
