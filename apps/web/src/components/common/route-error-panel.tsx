import { Link } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type RouteErrorPanelProps = {
  error: unknown;
  reset: () => void;
};

export function RouteErrorPanel({ error, reset }: RouteErrorPanelProps) {
  const errorMessage =
    error instanceof Error ? error.message : "不明なエラーが発生しました";

  return (
    <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
      <h1 className="text-xl font-semibold">エラーが発生しました</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        このページの表示中に問題が発生しました。再試行しても解決しない場合は、前の画面へ戻って操作をやり直してください。
      </p>
      {import.meta.env.DEV ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
          {errorMessage}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={reset} type="button" variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          再試行
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">ホームへ戻る</Link>
        </Button>
      </div>
    </div>
  );
}
