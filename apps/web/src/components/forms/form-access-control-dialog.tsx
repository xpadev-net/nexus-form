import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FC, useState } from "react";
import { Button } from "@/components/ui/button";
import { client, rpc } from "@/lib/api";

interface FormAccessControlDialogProps {
  formId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const FormAccessControlDialog: FC<FormAccessControlDialogProps> = ({
  formId,
  isOpen,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("VIEWER");

  const permissionsQuery = useQuery({
    queryKey: ["formPermissions", formId],
    queryFn: () =>
      rpc(
        client.api.forms[":id"].permissions.$get({
          param: { id: formId },
          query: {},
        }),
      ),
    enabled: isOpen && !!formId,
  });

  const addPermission = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"].permissions.$post({
          param: { id: formId },
          json: { userId, role },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["formPermissions", formId],
      });
      setUserId("");
    },
  });

  const removePermission = useMutation({
    mutationFn: (permissionId: string) =>
      rpc(
        client.api.forms[":id"].permissions[":userId"].$delete({
          param: { id: formId, userId: permissionId },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["formPermissions", formId],
      });
    },
  });

  if (!isOpen) return null;

  const permissions = permissionsQuery.data?.permissions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="w-full max-w-lg rounded-lg bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">アクセス制御</h2>

        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="ユーザーID"
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "EDITOR" | "VIEWER")}
            className="rounded-md border px-2 py-2 text-sm"
          >
            <option value="VIEWER">閲覧者</option>
            <option value="EDITOR">編集者</option>
          </select>
          <Button
            type="button"
            onClick={() => addPermission.mutate()}
            disabled={!userId || addPermission.isPending}
          >
            追加
          </Button>
        </div>

        {permissionsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        ) : (
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {permissions.map((perm) => (
              <div
                key={perm.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <div className="text-sm font-medium">
                    {perm.user?.name ?? perm.user?.email ?? perm.user_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {perm.role}
                  </div>
                </div>
                {perm.role !== "OWNER" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePermission.mutate(perm.id)}
                    disabled={removePermission.isPending}
                    className="text-destructive hover:text-destructive hover:bg-transparent dark:hover:bg-transparent"
                  >
                    削除
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
};
