import { Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormPermissions } from "@/hooks/forms/use-form-permissions";

interface InvitationManagerProps {
  formId: string;
}

export function InvitationManager({ formId }: InvitationManagerProps) {
  const {
    invitationsQuery,
    createInvitationMutation,
    deleteInvitationMutation,
  } = useFormPermissions(formId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("VIEWER");

  const invitations = invitationsQuery.data?.invitations ?? [];

  const handleCreate = () => {
    const trimmed = email.trim();
    if (!trimmed) return;

    createInvitationMutation.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => {
          toast.success("招待を送信しました");
          setEmail("");
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "招待の送信に失敗しました",
          ),
      },
    );
  };

  const handleDelete = (invitationId: string) => {
    deleteInvitationMutation.mutate(invitationId, {
      onSuccess: () => toast.success("招待を取り消しました"),
    });
  };

  const errorMessage =
    invitationsQuery.error instanceof Error
      ? invitationsQuery.error.message
      : "招待一覧の取得に失敗しました。";

  return (
    <div className="space-y-4 rounded border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Mail className="h-4 w-4" />
        招待管理
      </h3>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            type="email"
            placeholder="メールアドレスを入力"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
        </div>
        <Select
          value={role}
          onValueChange={(value) => setRole(value as "EDITOR" | "VIEWER")}
        >
          <SelectTrigger className="w-28" aria-label="招待権限">
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
          disabled={createInvitationMutation.isPending || !email.trim()}
        >
          {createInvitationMutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3.5 w-3.5" />
          )}
          招待
        </Button>
      </div>

      {invitationsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : invitationsQuery.isError ? (
        <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="invitation-query-retry"
            onClick={() => void invitationsQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          保留中の招待はありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {invitations.map((invitation) => (
            <li
              key={invitation.id ?? invitation.email}
              className="flex items-center justify-between gap-2 rounded border p-2"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="truncate text-sm">
                  {invitation.email ?? "-"}
                </span>
                <Badge variant="outline">
                  {invitation.role === "EDITOR" ? "編集者" : "閲覧者"}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-destructive"
                onClick={() => invitation.id && handleDelete(invitation.id)}
                disabled={deleteInvitationMutation.isPending}
                aria-label="招待を取り消し"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
