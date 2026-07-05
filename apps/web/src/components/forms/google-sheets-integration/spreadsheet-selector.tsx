import {
  Check,
  ChevronDown,
  FileSpreadsheet,
  Folder,
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

const ROOT_FOLDER_LABEL = "マイドライブ";
const UNKNOWN_FOLDER_LABEL = "フォルダ情報なし";

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
  const isCurrentLinkedSpreadsheetFallback =
    currentLinkedSpreadsheet !== null &&
    !filteredSpreadsheets.some(
      (spreadsheet) => spreadsheet.id === currentLinkedSpreadsheet.id,
    );

  const recentSpreadsheets = useMemo(
    () =>
      filteredSpreadsheets
        .filter(
          (spreadsheet) =>
            spreadsheet.itemType === undefined ||
            spreadsheet.itemType === "spreadsheet",
        )
        .filter((spreadsheet) => spreadsheet.id !== currentLinkedSpreadsheetId)
        .slice(0, SPREADSHEET_SELECTOR_RESULT_LIMIT),
    [currentLinkedSpreadsheetId, filteredSpreadsheets],
  );
  const folderTree = useMemo(
    () => buildSpreadsheetFolderTree(recentSpreadsheets),
    [recentSpreadsheets],
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

    if (!currentLinkedSpreadsheetId) {
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
                            folderLabel={
                              isCurrentLinkedSpreadsheetFallback
                                ? ""
                                : undefined
                            }
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
                        label={`フォルダから選択（最大${SPREADSHEET_SELECTOR_RESULT_LIMIT}件）`}
                      >
                        {recentSpreadsheets.length === 0 ? (
                          <EmptyOptionMessage>
                            スプレッドシートが見つかりません
                          </EmptyOptionMessage>
                        ) : (
                          <SpreadsheetFolderTree
                            nodes={folderTree}
                            selectedSpreadsheetId={selectedSpreadsheetId}
                            shouldShowSpreadsheetId={shouldShowSpreadsheetId}
                            onSelect={confirmSpreadsheetSelection}
                          />
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
  folderLabel?: string;
  statusLabel?: string;
  onSelect: (spreadsheet: Spreadsheet) => void;
}

function SpreadsheetOptionButton({
  spreadsheet,
  isSelected,
  showSpreadsheetId,
  folderLabel,
  statusLabel,
  onSelect,
}: SpreadsheetOptionButtonProps) {
  const displayName = getSpreadsheetDisplayName(spreadsheet);
  const detailLabel = getSpreadsheetDetailLabel({
    spreadsheet,
    folderLabel,
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

interface SpreadsheetFolderTreeProps {
  nodes: SpreadsheetFolderNode[];
  selectedSpreadsheetId: string;
  shouldShowSpreadsheetId: (spreadsheet: Spreadsheet) => boolean;
  onSelect: (spreadsheet: Spreadsheet) => void;
}

function SpreadsheetFolderTree({
  nodes,
  selectedSpreadsheetId,
  shouldShowSpreadsheetId,
  onSelect,
}: SpreadsheetFolderTreeProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <SpreadsheetFolderNodeView
          key={node.key}
          node={node}
          depth={0}
          selectedSpreadsheetId={selectedSpreadsheetId}
          shouldShowSpreadsheetId={shouldShowSpreadsheetId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface SpreadsheetFolderNodeViewProps {
  node: SpreadsheetFolderNode;
  depth: number;
  selectedSpreadsheetId: string;
  shouldShowSpreadsheetId: (spreadsheet: Spreadsheet) => boolean;
  onSelect: (spreadsheet: Spreadsheet) => void;
}

function SpreadsheetFolderNodeView({
  node,
  depth,
  selectedSpreadsheetId,
  shouldShowSpreadsheetId,
  onSelect,
}: SpreadsheetFolderNodeViewProps) {
  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground"
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.label}</span>
      </div>
      {node.entries.map(({ spreadsheet, folderLabel }) => (
        <div
          key={`${node.key}:${spreadsheet.id}`}
          style={{ paddingLeft: `${depth * 0.75}rem` }}
        >
          <SpreadsheetOptionButton
            spreadsheet={spreadsheet}
            isSelected={selectedSpreadsheetId === spreadsheet.id}
            showSpreadsheetId={shouldShowSpreadsheetId(spreadsheet)}
            folderLabel={folderLabel}
            statusLabel={
              selectedSpreadsheetId === spreadsheet.id ? "選択中" : undefined
            }
            onSelect={onSelect}
          />
        </div>
      ))}
      {node.children.map((childNode) => (
        <SpreadsheetFolderNodeView
          key={childNode.key}
          node={childNode}
          depth={depth + 1}
          selectedSpreadsheetId={selectedSpreadsheetId}
          shouldShowSpreadsheetId={shouldShowSpreadsheetId}
          onSelect={onSelect}
        />
      ))}
    </div>
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
  folderLabel,
  showSpreadsheetId,
  statusLabel,
}: {
  spreadsheet: Spreadsheet;
  folderLabel?: string;
  showSpreadsheetId: boolean;
  statusLabel?: string;
}): string {
  const resolvedFolderLabel =
    folderLabel ?? getSpreadsheetFolderLabel(spreadsheet);
  const labels = [statusLabel, resolvedFolderLabel].filter(
    (label): label is string => Boolean(label),
  );

  if (showSpreadsheetId) {
    labels.push(`ID: ${compactSpreadsheetId(spreadsheet.id)}`);
  }

  return labels.join(" / ");
}

interface SpreadsheetFolderNode {
  key: string;
  label: string;
  entries: SpreadsheetFolderEntry[];
  children: SpreadsheetFolderNode[];
}

interface MutableSpreadsheetFolderNode {
  key: string;
  label: string;
  entries: SpreadsheetFolderEntry[];
  children: Map<string, MutableSpreadsheetFolderNode>;
}

interface SpreadsheetFolderEntry {
  spreadsheet: Spreadsheet;
  folderLabel: string;
}

interface SpreadsheetFolderPathSegment {
  id: string;
  name: string;
}

interface SpreadsheetFolderPathEntry {
  pathSegments: SpreadsheetFolderPathSegment[];
  folderLabel: string;
}

function buildSpreadsheetFolderTree(
  spreadsheets: Spreadsheet[],
): SpreadsheetFolderNode[] {
  const roots = new Map<string, MutableSpreadsheetFolderNode>();

  for (const spreadsheet of spreadsheets) {
    for (const folderEntry of getSpreadsheetFolderEntries(spreadsheet)) {
      let currentLevel = roots;
      let currentNode: MutableSpreadsheetFolderNode | null = null;

      for (const segment of folderEntry.pathSegments) {
        const node = ensureFolderNode(currentLevel, segment.id, segment.name);
        currentNode = node;
        currentLevel = node.children;
      }

      currentNode?.entries.push({
        spreadsheet,
        folderLabel: folderEntry.folderLabel,
      });
    }
  }

  return [...roots.values()].map(toSpreadsheetFolderNode);
}

function ensureFolderNode(
  nodes: Map<string, MutableSpreadsheetFolderNode>,
  key: string,
  label: string,
): MutableSpreadsheetFolderNode {
  const existingNode = nodes.get(key);
  if (existingNode) return existingNode;

  const node: MutableSpreadsheetFolderNode = {
    key,
    label,
    entries: [],
    children: new Map(),
  };
  nodes.set(key, node);
  return node;
}

function toSpreadsheetFolderNode(
  node: MutableSpreadsheetFolderNode,
): SpreadsheetFolderNode {
  return {
    key: node.key,
    label: node.label,
    entries: node.entries,
    children: [...node.children.values()].map(toSpreadsheetFolderNode),
  };
}

function getSpreadsheetFolderEntries(
  spreadsheet: Spreadsheet,
): SpreadsheetFolderPathEntry[] {
  const validFolderPaths = (spreadsheet.folderPaths ?? [])
    .map((folderPath) => folderPath.pathSegments)
    .filter((pathSegments) => pathSegments.length > 0);

  if (validFolderPaths.length > 0) {
    return validFolderPaths.map((pathSegments) =>
      toSpreadsheetFolderEntry(
        pathSegments.map((segment) => ({
          id: segment.id,
          name: segment.name.trim() || UNKNOWN_FOLDER_LABEL,
        })),
      ),
    );
  }

  if ((spreadsheet.parents ?? []).length > 0) {
    return [
      toSpreadsheetFolderEntry([
        { id: "__unknown-folder__", name: UNKNOWN_FOLDER_LABEL },
      ]),
    ];
  }

  if (spreadsheet.parents) {
    return [
      toSpreadsheetFolderEntry([{ id: "__root__", name: ROOT_FOLDER_LABEL }]),
    ];
  }

  return [
    toSpreadsheetFolderEntry([
      { id: "__unknown-folder__", name: UNKNOWN_FOLDER_LABEL },
    ]),
  ];
}

function toSpreadsheetFolderEntry(
  pathSegments: SpreadsheetFolderPathSegment[],
): SpreadsheetFolderPathEntry {
  return {
    pathSegments,
    folderLabel: pathSegments.map((segment) => segment.name).join(" / "),
  };
}

function getSpreadsheetFolderLabel(
  spreadsheet: Spreadsheet,
): string | undefined {
  const [primaryFolderEntry] = getSpreadsheetFolderEntries(spreadsheet);

  return primaryFolderEntry?.folderLabel;
}

function compactSpreadsheetId(spreadsheetId: string) {
  if (spreadsheetId.length <= 16) return spreadsheetId;

  return `${spreadsheetId.slice(0, 8)}...${spreadsheetId.slice(-4)}`;
}
