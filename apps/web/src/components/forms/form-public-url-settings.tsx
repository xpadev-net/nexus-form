import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { client, rpc } from "@/lib/api";

interface FormPublicUrlSettingsProps {
  formId: string;
}

export function buildPublicFormUrl(publicId: string): string {
  return `${window.location.origin}/forms/public/${publicId}`;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the textarea copy path below when the Clipboard API is unavailable at runtime.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  Object.assign(textArea.style, {
    left: "-999999px",
    position: "fixed",
  });
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

export function FormPublicUrlSettings({ formId }: FormPublicUrlSettingsProps) {
  const queryClient = useQueryClient();
  const [newPublicUrl, setNewPublicUrl] = useState<string | null>(null);

  const regenerateMutation = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"]["regenerate-public-url"].$post({
          param: { id: formId },
        }),
      ),
    onSuccess: (data) => {
      const url = buildPublicFormUrl(data.publicId);
      setNewPublicUrl(url);
      toast.success("公開 URL を再生成しました");
      void queryClient.invalidateQueries({ queryKey: ["formDetail", formId] });
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "公開 URL の再生成に失敗しました",
      );
    },
  });

  const handleCopy = async () => {
    if (!newPublicUrl) return;

    const copied = await copyText(newPublicUrl);
    if (copied) {
      toast.success("新しい公開 URL をコピーしました");
      return;
    }
    toast.error("公開 URL のコピーに失敗しました");
  };

  return (
    <div className="w-full space-y-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={regenerateMutation.isPending}
          >
            {regenerateMutation.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            公開 URL を再生成
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>公開 URL を再生成しますか？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                現在の公開 URL は無効になり、旧 URL からは回答できなくなります。
              </span>
              <span className="block">
                既存の回答は保持されますが、新しい URL
                を共有先へ再配布する必要があります。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
            >
              再生成する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {newPublicUrl ? (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <label
            htmlFor="regenerated-public-url"
            className="text-sm font-medium"
          >
            新しい公開 URL
          </label>
          <div className="flex gap-2">
            <Input
              id="regenerated-public-url"
              readOnly
              value={newPublicUrl}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="新しい公開 URL をコピー"
              onClick={handleCopy}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            この URL を回答者や共有先へ再配布してください。
          </p>
        </div>
      ) : null}
    </div>
  );
}
