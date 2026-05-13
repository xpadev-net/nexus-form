import { Loader2 } from "lucide-react";
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

interface FormDeletionModalProps {
  open: boolean;
  title?: string;
  isDeleting?: boolean;
  onConfirm?: () => void;
  onClose?: () => void;
}

export function FormDeletionModal({
  open,
  title,
  isDeleting,
  onConfirm,
  onClose,
}: FormDeletionModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>フォーム削除</AlertDialogTitle>
          <AlertDialogDescription>
            {title
              ? `「${title}」を削除します。この操作は取り消せません。`
              : "フォームを削除します。この操作は取り消せません。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            キャンセル
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            削除する
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
