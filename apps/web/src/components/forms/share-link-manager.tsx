import { Copy, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
  const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null);

  const shareLinks = shareLinksQuery.data?.share_links ?? [];

  const handleCreate = () => {
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

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4" />
          共有リンク
        </h3>
        <div className="flex items-center gap-2">
          <Select
            value={newRole}
            onValueChange={(value) => setNewRole(value as "EDITOR" | "VIEWER")}
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
      </div>

      {shareLinksQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
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
