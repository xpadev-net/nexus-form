import { Copy, Link2, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useShareLinks } from "@/hooks/forms/use-share-links";
import { formatJapanDate } from "@/lib/formatters";

interface ShareLinkManagerProps {
  formId: string;
}

const roleSummaries = {
  VIEWER: {
    description: "フォーム内容の閲覧のみ。フォーム編集と回答閲覧はできません。",
  },
  EDITOR: {
    description:
      "フォーム構成や公開設定を編集でき、送信済み回答も閲覧できます。",
  },
} as const;

function isShareLinkRole(value: string): value is "EDITOR" | "VIEWER" {
  return value === "EDITOR" || value === "VIEWER";
}

export function ShareLinkManager({ formId }: ShareLinkManagerProps) {
  const {
    shareLinksQuery,
    createShareLinkMutation,
    deleteShareLinkMutation,
    toggleShareLinkStatusMutation,
    buildShareLinkUrl,
    copyShareLinkUrl,
  } = useShareLinks(formId);
  const [newRole, setNewRole] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [isEditorConfirmOpen, setIsEditorConfirmOpen] = useState(false);
  const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null);

  const shareLinks = shareLinksQuery.data?.share_links ?? [];

  const createSelectedShareLink = () => {
    setIsEditorConfirmOpen(false);
    createShareLinkMutation.mutate(
      { role: newRole },
      {
        onSuccess: () => toast.success("共有リンクを作成しました"),
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "作成に失敗しました",
          ),
      },
    );
  };

  const handleCreate = () => {
    if (newRole === "EDITOR") {
      setIsEditorConfirmOpen(true);
      return;
    }
    createSelectedShareLink();
  };

  const handleCopy = async (token: string) => {
    const fallbackUrl = buildShareLinkUrl(token);
    try {
      const { copied, url } = await copyShareLinkUrl(token);
      if (!copied) {
        setManualCopyUrl(url);
        toast.error(
          "リンクをコピーできませんでした。手動でコピーしてください。",
        );
        return;
      }
      setManualCopyUrl(null);
      toast.success("リンクをコピーしました");
    } catch {
      setManualCopyUrl(fallbackUrl);
      toast.error("リンクをコピーできませんでした。手動でコピーしてください。");
    }
  };

  const handleToggle = (linkId: string, isActive: boolean) => {
    toggleShareLinkStatusMutation.mutate({ linkId, isActive });
  };

  const handleDelete = (linkId: string) => {
    deleteShareLinkMutation.mutate(linkId, {
      onSuccess: () => {
        setManualCopyUrl(null);
        toast.success("共有リンクを削除しました");
      },
    });
  };

  const errorMessage =
    shareLinksQuery.error instanceof Error
      ? shareLinksQuery.error.message
      : "共有リンクの取得に失敗しました。";

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4" />
          共有リンク
        </h3>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            <Select
              value={newRole}
              onValueChange={(value) => {
                if (isShareLinkRole(value)) setNewRole(value);
              }}
            >
              <SelectTrigger className="w-28" aria-label="権限">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIEWER">閲覧者</SelectItem>
                <SelectItem value="EDITOR">編集者</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={createShareLinkMutation.isPending}
            >
              {createShareLinkMutation.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              作成
            </Button>
          </div>
          <div className="max-w-md rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
            <dl className="space-y-1.5">
              <div>
                <dt className="inline font-medium text-foreground">閲覧者: </dt>
                <dd className="inline">{roleSummaries.VIEWER.description}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">編集者: </dt>
                <dd className="inline">{roleSummaries.EDITOR.description}</dd>
              </div>
            </dl>
          </div>
          <Alert className="max-w-md py-2">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              新規リンクは期限なしで作成されます。不要になったリンクは無効化または削除してください。
            </AlertDescription>
          </Alert>
        </div>
      </div>

      <AlertDialog
        open={isEditorConfirmOpen}
        onOpenChange={setIsEditorConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>編集者リンクを作成しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              このリンクを持つユーザーはフォーム構成や公開設定を編集でき、送信済み回答も閲覧できます。新規リンクは期限なしで作成されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded border bg-muted/40 p-3 text-sm">
            <dl className="space-y-2">
              <div>
                <dt className="font-medium">編集可能範囲</dt>
                <dd className="text-muted-foreground">
                  フォーム構成、公開設定、回答管理に関わる編集操作
                </dd>
              </div>
              <div>
                <dt className="font-medium">回答閲覧</dt>
                <dd className="text-muted-foreground">
                  編集者リンクでは送信済み回答を閲覧できます
                </dd>
              </div>
              <div>
                <dt className="font-medium">期限</dt>
                <dd className="text-muted-foreground">
                  期限なし。共有先を限定し、不要になったら無効化してください
                </dd>
              </div>
            </dl>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={createSelectedShareLink}
              disabled={createShareLinkMutation.isPending}
            >
              編集者リンクを作成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {shareLinksQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : shareLinksQuery.isError ? (
        <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="share-link-query-retry"
            onClick={() => void shareLinksQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : shareLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          共有リンクはまだありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {shareLinks.map((link) => (
            <li
              key={link.id ?? link.token}
              className="flex items-center justify-between gap-2 rounded border p-2"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <Badge variant={link.is_active ? "default" : "secondary"}>
                  {link.is_active ? "有効" : "無効"}
                </Badge>
                <Badge variant="outline">
                  {link.role === "EDITOR" ? "編集者" : "閲覧者"}
                </Badge>
                {link.expires_at ? (
                  <span className="text-xs text-muted-foreground">
                    期限: {formatJapanDate(link.expires_at)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Switch
                  checked={link.is_active ?? false}
                  onCheckedChange={(checked) =>
                    link.id && handleToggle(link.id, checked)
                  }
                  aria-label="リンクの有効/無効を切り替え"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => link.token && void handleCopy(link.token)}
                  aria-label="リンクをコピー"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive"
                  onClick={() => link.id && handleDelete(link.id)}
                  disabled={deleteShareLinkMutation.isPending}
                  aria-label="リンクを削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {manualCopyUrl ? (
        <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-destructive">
              自動コピーに失敗しました。以下の URL を手動でコピーしてください。
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setManualCopyUrl(null)}
            >
              閉じる
            </Button>
          </div>
          <input
            className="w-full rounded border bg-background px-2 py-1 text-sm"
            readOnly
            value={manualCopyUrl}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="手動コピー用共有リンク"
          />
        </div>
      ) : null}
    </div>
  );
}
