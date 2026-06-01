import { Link } from "@tanstack/react-router";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  homeActionLabel?: string;
  title?: string;
  description?: string;
  showHomeAction?: boolean;
}

export function FormNotFoundPage({
  homeActionLabel = "ホームへ戻る",
  title = "フォームが見つかりません",
  description = "このフォームは存在しないか、現在公開されていません。",
  showHomeAction = false,
}: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center text-card-foreground shadow-sm">
        <p className="text-6xl font-bold text-muted-foreground/30">404</p>
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        {showHomeAction ? (
          <Button asChild className="mt-6">
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              {homeActionLabel}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
