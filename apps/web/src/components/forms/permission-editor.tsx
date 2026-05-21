import { Shield, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormPermissions } from "@/hooks/forms/use-form-permissions";

interface PermissionEditorProps {
  formId: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "オーナー",
  EDITOR: "編集者",
  VIEWER: "閲覧者",
};

export function PermissionEditor({ formId }: PermissionEditorProps) {
  const {
    permissionsQuery,
    updatePermissionMutation,
    removePermissionMutation,
  } = useFormPermissions(formId);

  const permissions = permissionsQuery.data?.permissions ?? [];

  const handleRoleChange = (userId: string, role: "EDITOR" | "VIEWER") => {
    updatePermissionMutation.mutate({ userId, role });
  };

  const handleRemove = (userId: string) => {
    removePermissionMutation.mutate(userId);
  };

  const errorMessage =
    permissionsQuery.error instanceof Error
      ? permissionsQuery.error.message
      : "権限設定の取得に失敗しました。";

  return (
    <div className="space-y-4 rounded border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Shield className="h-4 w-4" />
        権限設定
      </h3>

      {permissionsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : permissionsQuery.isError ? (
        <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="permission-query-retry"
            onClick={() => void permissionsQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : permissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          権限が設定されているユーザーはいません。
        </p>
      ) : (
        <ul className="space-y-2">
          {permissions.map((permission) => {
            const isOwner = permission.role === "OWNER";
            return (
              <li
                key={permission.user_id}
                className="flex items-center justify-between gap-2 rounded border p-2"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="truncate text-sm">
                    {permission.user_id ?? "-"}
                  </span>
                  {isOwner ? (
                    <Badge>{ROLE_LABELS[permission.role ?? ""] ?? "-"}</Badge>
                  ) : null}
                </div>
                {isOwner ? null : (
                  <div className="flex items-center gap-1">
                    <Select
                      value={permission.role ?? "VIEWER"}
                      onValueChange={(value) =>
                        permission.user_id &&
                        handleRoleChange(
                          permission.user_id,
                          value as "EDITOR" | "VIEWER",
                        )
                      }
                    >
                      <SelectTrigger className="w-28" aria-label="権限を変更">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VIEWER">閲覧者</SelectItem>
                        <SelectItem value="EDITOR">編集者</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() =>
                        permission.user_id && handleRemove(permission.user_id)
                      }
                      disabled={removePermissionMutation.isPending}
                      aria-label="権限を削除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
