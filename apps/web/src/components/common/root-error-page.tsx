import { Link } from "@tanstack/react-router";
import { Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

type RootErrorPageProps = {
  error: unknown;
  reset: () => void;
};

export function RootErrorPage({ error, reset }: RootErrorPageProps) {
  usePageTitle("エラーが発生しました");

  const errorMessage =
    error instanceof Error ? error.message : "不明なエラーが発生しました";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center text-card-foreground shadow-sm">
        <p className="text-6xl font-bold text-destructive/30">Error</p>
        <h1 className="mt-4 text-2xl font-semibold">エラーが発生しました</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          ページの表示中に問題が発生しました。再試行しても解決しない場合は、ホームへ戻って操作をやり直してください。
        </p>
        {import.meta.env.DEV ? (
          <p className="mt-4 rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            {errorMessage}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={reset} type="button" variant="outline">
            <RotateCcw className="mr-2 h-4 w-4" />
            再試行
          </Button>
          <Button asChild>
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              ホームへ戻る
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
