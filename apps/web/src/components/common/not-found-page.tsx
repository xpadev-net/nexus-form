import { Link } from "@tanstack/react-router";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

export function NotFoundPage() {
  usePageTitle("ページが見つかりません");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center text-card-foreground shadow-sm">
        <p className="text-6xl font-bold text-muted-foreground/30">404</p>
        <h1 className="mt-4 text-2xl font-semibold">ページが見つかりません</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            <Home className="mr-2 h-4 w-4" />
            ホームへ戻る
          </Link>
        </Button>
      </div>
    </div>
  );
}
