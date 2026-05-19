import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Sheet } from "./types";

interface SheetSelectorProps {
  selectedSheetName: string;
  sheets: Sheet[];
  isFetchingSheets: boolean;
  sheetsErrorMessage: string | null;
  isSheetDialogOpen: boolean;
  newSheetTitle: string;
  isAddingSheet: boolean;
  onSelectSheet: (sheetName: string) => void;
  onSheetDialogOpenChange: (open: boolean) => void;
  onNewSheetTitleChange: (value: string) => void;
  onAddSheet: () => void;
}

export function SheetSelector({
  selectedSheetName,
  sheets,
  isFetchingSheets,
  sheetsErrorMessage,
  isSheetDialogOpen,
  newSheetTitle,
  isAddingSheet,
  onSelectSheet,
  onSheetDialogOpenChange,
  onNewSheetTitleChange,
  onAddSheet,
}: SheetSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>シート</Label>
        <Dialog open={isSheetDialogOpen} onOpenChange={onSheetDialogOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              シートを追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新しいシートを追加</DialogTitle>
              <DialogDescription>
                選択中のスプレッドシートに新しいシートを追加します。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-sheet-title">シート名</Label>
              <Input
                id="new-sheet-title"
                placeholder="例: 1月集計"
                value={newSheetTitle}
                onChange={(event) => onNewSheetTitleChange(event.target.value)}
                disabled={isAddingSheet}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onSheetDialogOpenChange(false)}
                disabled={isAddingSheet}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                onClick={onAddSheet}
                disabled={isAddingSheet}
              >
                {isAddingSheet ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    追加中...
                  </>
                ) : (
                  "追加する"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isFetchingSheets ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sheetsErrorMessage ? (
        <div className="text-sm text-destructive">{sheetsErrorMessage}</div>
      ) : sheets.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          シートが見つかりません
        </div>
      ) : (
        <ScrollArea className="h-[120px] rounded-md border">
          <div className="p-2 space-y-1">
            {sheets.map((sheet) => (
              <button
                key={sheet.title}
                type="button"
                onClick={() => onSelectSheet(sheet.title)}
                className={[
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  selectedSheetName === sheet.title
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                ].join(" ")}
              >
                {sheet.title}
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
