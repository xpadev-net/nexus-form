import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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
import { buildPublicFormUrl } from "@/lib/forms/public-url";

interface FormPublicUrlSettingsProps {
  formId: string;
  publicId?: string | null;
}

interface PublicUrlCopyFieldProps {
  id: string;
  label: string;
  url: string;
  copiedMessage: string;
  description?: string;
}

type RegeneratedPublicIdState = {
  formId: string;
  publicId: string;
  previousPublicId: string | null;
};

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

export function PublicUrlCopyField({
  id,
  label,
  url,
  copiedMessage,
  description,
}: PublicUrlCopyFieldProps) {
  const handleCopy = async () => {
    const copied = await copyText(url);
    if (copied) {
      toast.success(copiedMessage);
      return;
    }
    toast.error("公開 URL のコピーに失敗しました");
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={url} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${label} をコピー`}
          onClick={handleCopy}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function FormPublicUrlSettings({
  formId,
  publicId,
}: FormPublicUrlSettingsProps) {
  const queryClient = useQueryClient();
  const [regeneratedPublicIdState, setRegeneratedPublicIdState] =
    useState<RegeneratedPublicIdState | null>(null);
  const regeneratedPublicId =
    regeneratedPublicIdState?.formId === formId
      ? regeneratedPublicIdState.publicId
      : null;
  const displayedPublicId = regeneratedPublicId ?? publicId ?? null;
  const currentPublicUrl = displayedPublicId
    ? buildPublicFormUrl(displayedPublicId)
    : null;

  useEffect(() => {
    setRegeneratedPublicIdState((current) =>
      current?.formId === formId ? current : null,
    );
  }, [formId]);

  useEffect(() => {
    if (!publicId || !regeneratedPublicIdState) return;
    if (regeneratedPublicIdState.formId !== formId) return;
    if (
      publicId !== regeneratedPublicIdState.publicId &&
      publicId !== regeneratedPublicIdState.previousPublicId
    ) {
      setRegeneratedPublicIdState(null);
    }
  }, [formId, publicId, regeneratedPublicIdState]);

  const regenerateMutation = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"]["regenerate-public-url"].$post({
          param: { id: formId },
        }),
      ),
    onSuccess: (data) => {
      setRegeneratedPublicIdState({
        formId,
        publicId: data.publicId,
        previousPublicId: publicId ?? null,
      });
      queryClient.setQueryData<{ form?: { publicId?: string | null } }>(
        ["formDetail", formId],
        (current) => {
          if (!current?.form) return current;
          return {
            ...current,
            form: { ...current.form, publicId: data.publicId },
          };
        },
      );
      toast.success(
        "公開 URL を再生成しました。旧 URL は無効になり、既存の回答は保持されています。",
      );
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

  return (
    <div className="w-full space-y-3">
      {currentPublicUrl ? (
        <PublicUrlCopyField
          id="current-public-url"
          label="現在の公開 URL"
          url={currentPublicUrl}
          copiedMessage="公開 URL をコピーしました"
          description="回答者へ共有する公開フォームの URL です。"
        />
      ) : null}

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

      {regeneratedPublicId ? (
        <PublicUrlCopyField
          id="regenerated-public-url"
          label="新しい公開 URL"
          url={buildPublicFormUrl(regeneratedPublicId)}
          copiedMessage="新しい公開 URL をコピーしました"
          description="旧 URL は無効です。この URL を回答者や共有先へ再配布してください。既存の回答は保持されています。"
        />
      ) : null}
    </div>
  );
}
