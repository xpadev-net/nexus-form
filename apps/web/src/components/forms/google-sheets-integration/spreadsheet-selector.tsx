import { Loader2, RefreshCw, Search } from "lucide-react";
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
import type { Spreadsheet } from "./types";

interface SpreadsheetSelectorProps {
  searchQuery: string;
  selectedSpreadsheetId: string;
  filteredSpreadsheets: Spreadsheet[];
  isFetchingSpreadsheets: boolean;
  spreadsheetsErrorMessage: string | null;
  isSpreadsheetDialogOpen: boolean;
  newSpreadsheetTitle: string;
  isCreatingSpreadsheet: boolean;
  onSearchQueryChange: (value: string) => void;
  onRefreshSpreadsheets: () => void;
  onSelectSpreadsheet: (spreadsheetId: string) => void;
  onSpreadsheetDialogOpenChange: (open: boolean) => void;
  onNewSpreadsheetTitleChange: (value: string) => void;
  onCreateSpreadsheet: () => void;
}

export function SpreadsheetSelector({
  searchQuery,
  selectedSpreadsheetId,
  filteredSpreadsheets,
  isFetchingSpreadsheets,
  spreadsheetsErrorMessage,
  isSpreadsheetDialogOpen,
  newSpreadsheetTitle,
  isCreatingSpreadsheet,
  onSearchQueryChange,
  onRefreshSpreadsheets,
  onSelectSpreadsheet,
  onSpreadsheetDialogOpenChange,
  onNewSpreadsheetTitleChange,
  onCreateSpreadsheet,
}: SpreadsheetSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>スプレッドシート</Label>
        <Dialog
          open={isSpreadsheetDialogOpen}
          onOpenChange={onSpreadsheetDialogOpenChange}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              スプレッドシートを作成
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新しいスプレッドシート</DialogTitle>
              <DialogDescription>
                オーナーアカウントで空のスプレッドシートを作成します。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-spreadsheet-title">名前</Label>
              <Input
                id="new-spreadsheet-title"
                placeholder="例: 2025年問い合わせフォーム"
                value={newSpreadsheetTitle}
                onChange={(event) =>
                  onNewSpreadsheetTitleChange(event.target.value)
                }
                disabled={isCreatingSpreadsheet}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onSpreadsheetDialogOpenChange(false)}
                disabled={isCreatingSpreadsheet}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                onClick={onCreateSpreadsheet}
                disabled={isCreatingSpreadsheet}
              >
                {isCreatingSpreadsheet ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    作成中...
                  </>
                ) : (
                  "作成する"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="スプレッドシートを検索..."
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={onRefreshSpreadsheets}
          disabled={isFetchingSpreadsheets}
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetchingSpreadsheets ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
      <ScrollArea className="h-[200px] rounded-md border">
        {isFetchingSpreadsheets ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : spreadsheetsErrorMessage ? (
          <div className="flex items-center justify-center px-4 py-6 text-center text-sm text-destructive">
            {spreadsheetsErrorMessage}
          </div>
        ) : filteredSpreadsheets.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            スプレッドシートが見つかりません
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredSpreadsheets.map((spreadsheet) => (
              <button
                key={spreadsheet.id}
                type="button"
                onClick={() => onSelectSpreadsheet(spreadsheet.id)}
                className={[
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  selectedSpreadsheetId === spreadsheet.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                ].join(" ")}
              >
                <div className="font-medium">{spreadsheet.name || "無題"}</div>
                <div className="text-xs opacity-70 truncate">
                  {spreadsheet.id}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
