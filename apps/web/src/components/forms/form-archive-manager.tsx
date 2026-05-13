import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
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

interface FormArchiveManagerProps {
  isArchived: boolean;
  isLoading?: boolean;
  onArchive?: () => void;
  onUnarchive?: () => void;
}

export function FormArchiveManager({
  isArchived,
  isLoading,
  onArchive,
  onUnarchive,
}: FormArchiveManagerProps) {
  if (isArchived) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onUnarchive}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
        )}
        アーカイブ解除
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Archive className="mr-1 h-3.5 w-3.5" />
          )}
          アーカイブ
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>フォームをアーカイブ</AlertDialogTitle>
          <AlertDialogDescription>
            アーカイブするとフォーム一覧に表示されなくなります。いつでも復元できます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={onArchive}>
            アーカイブする
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
