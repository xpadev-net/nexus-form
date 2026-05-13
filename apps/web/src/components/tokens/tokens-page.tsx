import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ApiToken, useApiTokens } from "@/hooks/tokens/use-api-tokens";
import { usePageTitle } from "@/hooks/use-page-title";

function TokenRevealDialog({
  tokenValue,
  onClose,
}: {
  tokenValue: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tokenValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>APIトークンが作成されました</DialogTitle>
          <DialogDescription>
            このトークンは一度だけ表示されます。安全な場所にコピーして保管してください。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <div className="flex items-center gap-2 rounded border bg-muted p-3 font-mono text-xs break-all">
            <span className="flex-1 select-all">{tokenValue}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4 text-green-500" />
                コピー済み
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                クリップボードにコピー
              </>
            )}
          </Button>
          <Button type="button" className="w-full" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TokensPage() {
  usePageTitle("APIトークン管理");
  const { tokensQuery, createTokenMutation, revokeTokenMutation } =
    useApiTokens();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);

  const tokens =
    (tokensQuery.data as { tokens?: ApiToken[] } | undefined)?.tokens ?? [];
  const isLoading = tokensQuery.isPending;
  const isCreating = createTokenMutation.isPending;

  const createToken = async () => {
    if (!name.trim()) return;

    try {
      setError(null);
      const result = await createTokenMutation.mutateAsync({
        name: name.trim(),
        scopes: ["read"],
      });

      const tokenString = (result as { token?: { token?: string } })?.token
        ?.token;
      if (tokenString) {
        setNewTokenValue(tokenString);
      }
      setName("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "不明なエラーが発生しました",
      );
    }
  };

  const revokeToken = async (id: string) => {
    try {
      setError(null);
      await revokeTokenMutation.mutateAsync(id);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "不明なエラーが発生しました",
      );
    }
  };

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-card-foreground">
        APIトークン管理
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        APIトークンを作成・管理できます。
      </p>

      <div className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="トークン名"
          className="w-full rounded border bg-background px-3 py-2 text-sm"
          maxLength={100}
          disabled={isCreating}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void createToken()}
          disabled={isCreating || !name.trim()}
        >
          {isCreating ? "作成中..." : "作成"}
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {tokensQuery.error ? (
        <p className="mt-3 text-sm text-destructive">
          {tokensQuery.error instanceof Error
            ? tokensQuery.error.message
            : "トークン一覧の取得に失敗しました"}
        </p>
      ) : null}

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">読み込み中...</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center justify-between rounded border p-3"
            >
              <div>
                <p className="font-medium">{token.name}</p>
                <p className="text-xs text-muted-foreground">
                  scopes: {token.scopes.join(", ") || "-"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void revokeToken(token.id)}
                disabled={!token.is_active || revokeTokenMutation.isPending}
              >
                {token.is_active ? "失効" : "無効"}
              </Button>
            </li>
          ))}
          {tokens.length === 0 ? (
            <li className="rounded border p-3 text-sm text-muted-foreground">
              トークンはまだありません。
            </li>
          ) : null}
        </ul>
      )}

      {newTokenValue ? (
        <TokenRevealDialog
          tokenValue={newTokenValue}
          onClose={() => setNewTokenValue(null)}
        />
      ) : null}
    </section>
  );
}
