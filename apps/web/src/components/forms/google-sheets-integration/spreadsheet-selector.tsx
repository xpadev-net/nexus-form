import {
  Check,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SPREADSHEET_SELECTOR_RESULT_LIMIT, type Spreadsheet } from "./types";

interface SpreadsheetSelectorProps {
  searchQuery: string;
  selectedSpreadsheetId: string;
  selectedSpreadsheetName?: string;
  currentLinkedSpreadsheetId: string;
  currentLinkedSpreadsheetName?: string;
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
  selectedSpreadsheetName,
  currentLinkedSpreadsheetId,
  currentLinkedSpreadsheetName,
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
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [pendingSpreadsheet, setPendingSpreadsheet] =
    useState<Spreadsheet | null>(null);

  const currentLinkedSpreadsheet = useMemo<Spreadsheet | null>(() => {
    if (!currentLinkedSpreadsheetId) return null;

    const visibleSpreadsheet = filteredSpreadsheets.find(
      (spreadsheet) => spreadsheet.id === currentLinkedSpreadsheetId,
    );

    return (
      visibleSpreadsheet ?? {
        id: currentLinkedSpreadsheetId,
        name: currentLinkedSpreadsheetName,
      }
    );
  }, [
    currentLinkedSpreadsheetId,
    currentLinkedSpreadsheetName,
    filteredSpreadsheets,
  ]);

  const recentSpreadsheets = useMemo(
    () =>
      filteredSpreadsheets
        .filter((spreadsheet) => spreadsheet.id !== currentLinkedSpreadsheetId)
        .slice(0, SPREADSHEET_SELECTOR_RESULT_LIMIT),
    [currentLinkedSpreadsheetId, filteredSpreadsheets],
  );

  const duplicateNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const visibleSpreadsheets = currentLinkedSpreadsheet
      ? [currentLinkedSpreadsheet, ...recentSpreadsheets]
      : recentSpreadsheets;

    for (const spreadsheet of visibleSpreadsheets) {
      const name = getSpreadsheetDisplayName(spreadsheet);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return counts;
  }, [currentLinkedSpreadsheet, recentSpreadsheets]);

  const shouldShowSpreadsheetId = (spreadsheet: Spreadsheet) =>
    !spreadsheet.name?.trim() ||
    (duplicateNameCounts.get(getSpreadsheetDisplayName(spreadsheet)) ?? 0) > 1;

  const selectedSpreadsheetLabel =
    selectedSpreadsheetName ||
    (selectedSpreadsheetId
      ? `ID: ${compactSpreadsheetId(selectedSpreadsheetId)}`
      : "未選択");
  const selectedSpreadsheetDetail = selectedSpreadsheetId
    ? selectedSpreadsheetId === currentLinkedSpreadsheetId
      ? "現在連携中"
      : selectedSpreadsheetName
        ? "未保存の選択"
        : `ID: ${compactSpreadsheetId(selectedSpreadsheetId)}`
    : "クリックして候補を表示";

  const confirmSpreadsheetSelection = (spreadsheet: Spreadsheet) => {
    if (spreadsheet.id === selectedSpreadsheetId) {
      setIsSelectorOpen(false);
      return;
    }

    if (!selectedSpreadsheetId) {
      onSelectSpreadsheet(spreadsheet.id);
      setIsSelectorOpen(false);
      return;
    }

    setPendingSpreadsheet(spreadsheet);
    setIsSelectorOpen(false);
  };

  const commitPendingSpreadsheetSelection = () => {
    if (!pendingSpreadsheet) return;
    onSelectSpreadsheet(pendingSpreadsheet.id);
    setPendingSpreadsheet(null);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="spreadsheet-selector-trigger">スプレッドシート</Label>
        <div className="flex gap-2">
          <Popover open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
            <PopoverTrigger asChild>
              <Button
                id="spreadsheet-selector-trigger"
                type="button"
                variant="outline"
                role="combobox"
                aria-label={`スプレッドシート: ${selectedSpreadsheetLabel}`}
                aria-expanded={isSelectorOpen}
                aria-haspopup="listbox"
                aria-controls="spreadsheet-selector-list"
                className="h-auto min-h-11 flex-1 justify-between px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {selectedSpreadsheetLabel}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {selectedSpreadsheetDetail}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="z-[60] w-[min(42rem,calc(100vw-2rem))] p-0"
            >
              <div className="border-b p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="スプレッドシートを検索..."
                    value={searchQuery}
                    onChange={(event) =>
                      onSearchQueryChange(event.target.value)
                    }
                    className="pl-9"
                  />
                </div>
              </div>

              <ScrollArea className="h-72 max-h-[45vh]">
                <div
                  id="spreadsheet-selector-list"
                  role="listbox"
                  aria-label="スプレッドシート候補"
                  className="p-2"
                >
                  {isFetchingSpreadsheets ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : spreadsheetsErrorMessage ? (
                    <div className="flex items-center justify-center px-4 py-6 text-center text-sm text-destructive">
                      {spreadsheetsErrorMessage}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <SpreadsheetOptionGroup label="現在連携中">
                        {currentLinkedSpreadsheet ? (
                          <SpreadsheetOptionButton
                            spreadsheet={currentLinkedSpreadsheet}
                            isSelected={
                              selectedSpreadsheetId ===
                              currentLinkedSpreadsheet.id
                            }
                            showSpreadsheetId={shouldShowSpreadsheetId(
                              currentLinkedSpreadsheet,
                            )}
                            statusLabel="現在連携中"
                            onSelect={confirmSpreadsheetSelection}
                          />
                        ) : (
                          <EmptyOptionMessage>
                            保存済みの連携先はありません
                          </EmptyOptionMessage>
                        )}
                      </SpreadsheetOptionGroup>

                      <SpreadsheetOptionGroup
                        label={`最近使ったもの（最大${SPREADSHEET_SELECTOR_RESULT_LIMIT}件）`}
                      >
                        {recentSpreadsheets.length === 0 ? (
                          <EmptyOptionMessage>
                            スプレッドシートが見つかりません
                          </EmptyOptionMessage>
                        ) : (
                          <div className="space-y-1">
                            {recentSpreadsheets.map((spreadsheet) => (
                              <SpreadsheetOptionButton
                                key={spreadsheet.id}
                                spreadsheet={spreadsheet}
                                isSelected={
                                  selectedSpreadsheetId === spreadsheet.id
                                }
                                showSpreadsheetId={shouldShowSpreadsheetId(
                                  spreadsheet,
                                )}
                                statusLabel={
                                  selectedSpreadsheetId === spreadsheet.id
                                    ? "選択中"
                                    : undefined
                                }
                                onSelect={confirmSpreadsheetSelection}
                              />
                            ))}
                          </div>
                        )}
                      </SpreadsheetOptionGroup>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    setIsSelectorOpen(false);
                    onSpreadsheetDialogOpenChange(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  新しいスプレッドシートを作成
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="icon"
            aria-label="スプレッドシート一覧を再取得"
            onClick={onRefreshSpreadsheets}
            disabled={isFetchingSpreadsheets}
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetchingSpreadsheets ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingSpreadsheet !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSpreadsheet(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>連携先を変更しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              現在の選択を「
              {getSpreadsheetDisplayName(pendingSpreadsheet) || "無題"}
              」に変更します。
              {pendingSpreadsheet
                ? ` ID: ${compactSpreadsheetId(pendingSpreadsheet.id)}。`
                : ""}
              保存するまで同期先には反映されません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={commitPendingSpreadsheetSelection}>
              変更する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={isSpreadsheetDialogOpen}
        onOpenChange={onSpreadsheetDialogOpenChange}
      >
        <NewSpreadsheetDialogContent
          newSpreadsheetTitle={newSpreadsheetTitle}
          isCreatingSpreadsheet={isCreatingSpreadsheet}
          onNewSpreadsheetTitleChange={onNewSpreadsheetTitleChange}
          onSpreadsheetDialogOpenChange={onSpreadsheetDialogOpenChange}
          onCreateSpreadsheet={onCreateSpreadsheet}
        />
      </Dialog>
    </div>
  );
}

interface NewSpreadsheetDialogContentProps {
  newSpreadsheetTitle: string;
  isCreatingSpreadsheet: boolean;
  onNewSpreadsheetTitleChange: (value: string) => void;
  onSpreadsheetDialogOpenChange: (open: boolean) => void;
  onCreateSpreadsheet: () => void;
}

function NewSpreadsheetDialogContent({
  newSpreadsheetTitle,
  isCreatingSpreadsheet,
  onNewSpreadsheetTitleChange,
  onSpreadsheetDialogOpenChange,
  onCreateSpreadsheet,
}: NewSpreadsheetDialogContentProps) {
  return (
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
          onChange={(event) => onNewSpreadsheetTitleChange(event.target.value)}
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
  );
}

interface SpreadsheetOptionGroupProps {
  label: string;
  children: ReactNode;
}

function SpreadsheetOptionGroup({
  label,
  children,
}: SpreadsheetOptionGroupProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: listbox children must expose role="group"; fieldset is not a permitted direct child.
    <div role="group" aria-label={label} className="space-y-1">
      <p className="px-2 text-xs font-medium text-muted-foreground" aria-hidden>
        {label}
      </p>
      {children}
    </div>
  );
}

interface SpreadsheetOptionButtonProps {
  spreadsheet: Spreadsheet;
  isSelected: boolean;
  showSpreadsheetId: boolean;
  statusLabel?: string;
  onSelect: (spreadsheet: Spreadsheet) => void;
}

function SpreadsheetOptionButton({
  spreadsheet,
  isSelected,
  showSpreadsheetId,
  statusLabel,
  onSelect,
}: SpreadsheetOptionButtonProps) {
  const displayName = getSpreadsheetDisplayName(spreadsheet);
  const detailLabel = getSpreadsheetDetailLabel({
    spreadsheet,
    showSpreadsheetId,
    statusLabel,
  });

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(spreadsheet)}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted",
      )}
    >
      <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{displayName}</span>
        {detailLabel && (
          <span className="block truncate text-xs text-muted-foreground">
            {detailLabel}
          </span>
        )}
      </span>
      {isSelected && <Check className="h-4 w-4 shrink-0" />}
    </button>
  );
}

function EmptyOptionMessage({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md px-3 py-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function getSpreadsheetDisplayName(spreadsheet: Spreadsheet | null) {
  if (!spreadsheet) return "";
  return spreadsheet.name?.trim() || "無題";
}

function getSpreadsheetDetailLabel({
  spreadsheet,
  showSpreadsheetId,
  statusLabel,
}: {
  spreadsheet: Spreadsheet;
  showSpreadsheetId: boolean;
  statusLabel?: string;
}) {
  if (!showSpreadsheetId) return statusLabel;

  const idLabel = `ID: ${compactSpreadsheetId(spreadsheet.id)}`;
  return statusLabel ? `${statusLabel} / ${idLabel}` : idLabel;
}

function compactSpreadsheetId(spreadsheetId: string) {
  if (spreadsheetId.length <= 16) return spreadsheetId;

  return `${spreadsheetId.slice(0, 8)}...${spreadsheetId.slice(-4)}`;
}
