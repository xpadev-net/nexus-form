import { Copy, Loader2 } from "lucide-react";
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

interface FormDuplicateModalProps {
  open: boolean;
  isDuplicating?: boolean;
  onConfirm?: () => void;
  onClose?: () => void;
  sourceTitle?: string;
}

export function FormDuplicateModal({
  open,
  isDuplicating,
  onConfirm,
  onClose,
  sourceTitle,
}: FormDuplicateModalProps) {
  const duplicateTitle = sourceTitle
    ? `${sourceTitle} のコピー`
    : "元フォーム名 のコピー";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !isDuplicating) onClose?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            フォーム複製
          </AlertDialogTitle>
          <AlertDialogDescription>
            このフォームを複製して「{duplicateTitle}」を作成します。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-2 rounded border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">公開状態</dt>
            <dd className="text-right font-medium">コピーせず下書きで作成</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">回答</dt>
            <dd className="text-right font-medium">コピーしない</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">共有設定</dt>
            <dd className="text-right font-medium">コピーしない</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">フォーム内容</dt>
            <dd className="text-right font-medium">
              質問とバリデーションをコピー
            </dd>
          </div>
        </dl>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDuplicating}>
            キャンセル
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isDuplicating}>
            {isDuplicating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            複製する
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
