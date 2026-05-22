import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-center text-2xl font-semibold">認証エラー</h1>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          サインイン処理で問題が発生しました。しばらくしてから再試行してください。
        </p>
        <div className="mt-6 flex justify-center">
          <Button variant="outline" asChild>
            <Link to="/login">ログイン画面へ戻る</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
