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
}

export function FormDuplicateModal({
  open,
  isDuplicating,
  onConfirm,
  onClose,
}: FormDuplicateModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            フォーム複製
          </AlertDialogTitle>
          <AlertDialogDescription>
            このフォームを複製して新しいフォームとして作成します。回答データは複製されません。
          </AlertDialogDescription>
        </AlertDialogHeader>
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
