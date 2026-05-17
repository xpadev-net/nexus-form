import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { apiUrl } from "@/lib/api";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { logError } from "@/lib/logger";
import type {
  FormIntegrationResponse,
  GoogleSheetsIntegrationSetting,
  SyncJobStatusResponse,
  SyncStartResponse,
} from "@/types/integrations/google-sheets";

interface GoogleSheetsIntegrationProps {
  formId: string;
  className?: string;
}

interface Spreadsheet {
  id: string;
  name?: string;
}

interface Sheet {
  sheetId?: number;
  title: string;
}

interface GoogleOAuthMessage {
  source: "google-oauth";
  status: "success" | "error";
  message?: string;
  state?: string | null;
}

const isGoogleOAuthMessage = (value: unknown): value is GoogleOAuthMessage => {
  if (!isRecord(value)) return false;
  return (
    value.source === "google-oauth" &&
    (value.status === "success" || value.status === "error")
  );
};

type UiSyncStatus = "queued" | "processing" | "completed" | "failed";

function mapBullMqStateToUiStatus(
  state: SyncJobStatusResponse["job"]["state"],
): UiSyncStatus {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
    case "unknown":
      return "failed";
    case "active":
      return "processing";
    default:
      return "queued";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clampPercentage(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function extractProgress(raw: unknown): UiSyncState["progress"] | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return { percentage: clampPercentage(raw) };
  if (!isRecord(raw)) return undefined;
  const result = {
    processed: typeof raw.processed === "number" ? raw.processed : undefined,
    total: typeof raw.total === "number" ? raw.total : undefined,
    percentage:
      typeof raw.percentage === "number"
        ? clampPercentage(raw.percentage)
        : undefined,
  };
  if (
    result.processed === undefined &&
    result.total === undefined &&
    result.percentage === undefined
  ) {
    return undefined;
  }
  return result;
}

function isJobResult(
  v: unknown,
): v is { updatedRows?: number; updatedRange?: string } {
  if (!isRecord(v)) return false;
  const validRows =
    v.updatedRows === undefined || typeof v.updatedRows === "number";
  const validRange =
    v.updatedRange === undefined || typeof v.updatedRange === "string";
  return validRows && validRange;
}

interface UiSyncState {
  jobId: string;
  status: UiSyncStatus;
  progress?: {
    processed?: number;
    total?: number;
    percentage?: number;
  };
  result?: {
    updatedRows?: number;
    updatedRange?: string;
  };
  error?: string;
}

export function GoogleSheetsIntegration({
  formId,
  className,
}: GoogleSheetsIntegrationProps) {
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const searchQueryRef = useRef(searchQuery);
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] =
    useState<string>("");

  const [selectedSheetName, setSelectedSheetName] = useState<string>("");

  // 同期状態
  const [syncStatus, setSyncStatus] = useState<UiSyncState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const [isSpreadsheetDialogOpen, setIsSpreadsheetDialogOpen] = useState(false);
  const [newSpreadsheetTitle, setNewSpreadsheetTitle] = useState("");
  const [isCreatingSpreadsheet, setIsCreatingSpreadsheet] = useState(false);

  const [isSheetDialogOpen, setIsSheetDialogOpen] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState("");
  const [isAddingSheet, setIsAddingSheet] = useState(false);

  const authWindowRef = useRef<Window | null>(null);
  const popupIntervalRef = useRef<number | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);
  const hasInitializedConfigRef = useRef(false);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current != null) {
        window.clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  const { data: syncJobData, error: syncJobError } = useQuery({
    queryKey: ["syncJobStatus", formId, activeJobId],
    queryFn: () =>
      fetchJson<SyncJobStatusResponse>(
        apiUrl(
          `/api/forms/${formId}/integrations/google-sheets/sync/${activeJobId}`,
        ),
      ),
    enabled: !!activeJobId && isSyncing,
    refetchInterval: (query) => {
      const state = query.state.data
        ? mapBullMqStateToUiStatus(query.state.data.job.state)
        : "queued";
      return state === "completed" || state === "failed" ? false : 1000;
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!syncJobData || !activeJobId) return;
    const uiStatus = mapBullMqStateToUiStatus(syncJobData.job.state);
    const jobProgress = extractProgress(syncJobData.job.progress);
    const jobResult = isJobResult(syncJobData.job.result)
      ? syncJobData.job.result
      : undefined;
    setSyncStatus({
      jobId: activeJobId,
      status: uiStatus,
      progress: jobProgress,
      result: jobResult,
      error: uiStatus === "failed" ? syncJobData.job.failedReason : undefined,
    });
    if (uiStatus === "completed") {
      if (syncTimeoutRef.current != null) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      toast.success("同期が完了しました");
      setIsSyncing(false);
      setActiveJobId(null);
    } else if (uiStatus === "failed") {
      if (syncTimeoutRef.current != null) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      toast.error("同期に失敗しました");
      setIsSyncing(false);
      setActiveJobId(null);
    }
  }, [syncJobData, activeJobId]);

  useEffect(() => {
    if (!syncJobError) return;
    if (syncTimeoutRef.current != null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    toast.error("同期状態の確認に失敗しました");
    setIsSyncing(false);
    setActiveJobId(null);
    setSyncStatus(null);
  }, [syncJobError]);

  const {
    data: connectionData,
    error: connectionError,
    isLoading: isCheckingConnection,
  } = useQuery({
    queryKey: ["google-connection"],
    queryFn: () =>
      fetchJson<{ spreadsheets: Spreadsheet[] }>(
        apiUrl("/api/integrations/google/spreadsheets?pageSize=1"),
      ),
    refetchOnWindowFocus: false,
  });

  const { data: savedConfig, isLoading: isLoadingConfig } = useQuery({
    queryKey: ["google-sheets-config", formId],
    queryFn: async () => {
      try {
        const data = await fetchJson<FormIntegrationResponse>(
          apiUrl(`/api/forms/${formId}/integrations/google-sheets`),
        );
        return data.integration?.config ?? null;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    refetchOnWindowFocus: false,
  });

  const isUnauthorized =
    connectionError instanceof HttpError && connectionError.status === 401;
  const isConnected = Boolean(connectionData && !isUnauthorized);
  const connectionLoadError =
    connectionError && !isUnauthorized
      ? connectionError instanceof Error
        ? connectionError.message
        : null
      : null;

  const {
    data: spreadsheetsData,
    error: spreadsheetsError,
    isLoading: isLoadingSpreadsheets,
    isFetching: isFetchingSpreadsheetsFetching,
  } = useQuery({
    queryKey: ["spreadsheets", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchQuery) params.set("query", searchQuery);
      return await fetchJson<{ spreadsheets: Spreadsheet[] }>(
        apiUrl(`/api/integrations/google/spreadsheets?${params}`),
      );
    },
    enabled: isConnected,
    refetchOnWindowFocus: false,
  });

  const {
    data: sheetsData,
    error: sheetsError,
    isLoading: isLoadingSheets,
    isFetching: isFetchingSheetsFetching,
  } = useQuery({
    queryKey: ["sheets", selectedSpreadsheetId],
    queryFn: async () =>
      await fetchJson<{ sheets: Sheet[] }>(
        apiUrl(
          `/api/integrations/google/spreadsheets/${selectedSpreadsheetId}/sheets`,
        ),
      ),
    enabled: !!selectedSpreadsheetId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (hasInitializedConfigRef.current || !savedConfig) return;

    if (savedConfig.spreadsheetId) {
      setSelectedSpreadsheetId(savedConfig.spreadsheetId);
    }
    if (savedConfig.sheetName) {
      setSelectedSheetName(savedConfig.sheetName);
    }
    hasInitializedConfigRef.current = true;
  }, [savedConfig]);

  // OAuth認証を開始
  const handleConnect = useCallback(async () => {
    try {
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const authWindow = window.open(
        apiUrl("/api/integrations/google/authorize"),
        "GoogleAuth",
        `width=${width},height=${height},left=${left},top=${top}`,
      );

      if (!authWindow) {
        toast.error(
          "ポップアップを開けませんでした。ブラウザ設定を確認してください。",
        );
        return;
      }

      authWindowRef.current = authWindow;

      if (popupIntervalRef.current) {
        window.clearInterval(popupIntervalRef.current);
        popupIntervalRef.current = null;
      }

      popupIntervalRef.current = window.setInterval(() => {
        if (!authWindowRef.current || authWindowRef.current.closed) {
          if (popupIntervalRef.current) {
            window.clearInterval(popupIntervalRef.current);
            popupIntervalRef.current = null;
          }
          authWindowRef.current = null;
          void queryClient.invalidateQueries({
            queryKey: ["google-connection"],
          });
          void queryClient.invalidateQueries({ queryKey: ["spreadsheets"] });
        }
      }, 1000);
    } catch (error) {
      logError("Failed to start OAuth:", "ui", { error: error });
      toast.error("認証の開始に失敗しました");
    }
  }, [queryClient]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      if (!isGoogleOAuthMessage(event.data)) return;

      if (popupIntervalRef.current) {
        window.clearInterval(popupIntervalRef.current);
        popupIntervalRef.current = null;
      }

      if (authWindowRef.current && !authWindowRef.current.closed) {
        authWindowRef.current.close();
      }
      authWindowRef.current = null;

      if (event.data.status === "success") {
        toast.success("Googleアカウントに接続しました");
        void queryClient.invalidateQueries({ queryKey: ["google-connection"] });
        void queryClient.invalidateQueries({ queryKey: ["spreadsheets"] });
        return;
      }

      toast.error(
        event.data.message ?? "Google連携に失敗しました。再度お試しください。",
      );
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      if (popupIntervalRef.current) {
        window.clearInterval(popupIntervalRef.current);
        popupIntervalRef.current = null;
      }
      if (authWindowRef.current && !authWindowRef.current.closed) {
        authWindowRef.current.close();
      }
      authWindowRef.current = null;
    };
  }, [queryClient]);

  // スプレッドシート選択時
  const handleSelectSpreadsheet = useCallback(
    (spreadsheetId: string) => {
      setSelectedSpreadsheetId(spreadsheetId);
      setSelectedSheetName("");
      void queryClient.invalidateQueries({
        queryKey: ["sheets", spreadsheetId],
      });
    },
    [queryClient],
  );

  // シート選択時の処理
  const handleSelectSheet = useCallback((sheetName: string) => {
    setSelectedSheetName(sheetName);
  }, []);

  const handleCreateSpreadsheet = useCallback(async () => {
    const title = newSpreadsheetTitle.trim();
    if (!title) {
      toast.error("スプレッドシート名を入力してください");
      return;
    }

    setIsCreatingSpreadsheet(true);
    try {
      const data = await fetchJson<{
        spreadsheetId: string;
        defaultSheetTitle?: string;
      }>(apiUrl("/api/integrations/google/spreadsheets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      toast.success("スプレッドシートを作成しました");
      setIsSpreadsheetDialogOpen(false);
      setNewSpreadsheetTitle("");
      setSelectedSpreadsheetId(data.spreadsheetId);
      setSelectedSheetName(data.defaultSheetTitle || "");
      await queryClient.invalidateQueries({ queryKey: ["spreadsheets"] });
      void queryClient.invalidateQueries({
        queryKey: ["sheets", data.spreadsheetId],
      });
    } catch (error) {
      logError("Failed to create spreadsheet:", "ui", { error: error });
      toast.error("スプレッドシートの作成に失敗しました");
    } finally {
      setIsCreatingSpreadsheet(false);
    }
  }, [queryClient, newSpreadsheetTitle]);

  const handleAddSheet = useCallback(async () => {
    if (!selectedSpreadsheetId) {
      toast.error("先にスプレッドシートを選択してください");
      return;
    }
    const title = newSheetTitle.trim();
    if (!title) {
      toast.error("シート名を入力してください");
      return;
    }

    setIsAddingSheet(true);
    try {
      const data = await fetchJson<{ title?: string }>(
        apiUrl(
          `/api/integrations/google/spreadsheets/${selectedSpreadsheetId}/sheets`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      toast.success("シートを追加しました");
      setIsSheetDialogOpen(false);
      setNewSheetTitle("");
      await queryClient.invalidateQueries({
        queryKey: ["sheets", selectedSpreadsheetId],
      });
      setSelectedSheetName(data.title || title);
    } catch (error) {
      logError("Failed to add sheet:", "ui", { error: error });
      toast.error("シートの追加に失敗しました");
    } finally {
      setIsAddingSheet(false);
    }
  }, [queryClient, newSheetTitle, selectedSpreadsheetId]);

  // 設定を保存
  const handleSaveConfig = useCallback(async () => {
    if (!selectedSpreadsheetId || !selectedSheetName) {
      toast.error("スプレッドシートとシートを選択してください");
      return;
    }

    try {
      const config: GoogleSheetsIntegrationSetting = {
        spreadsheetId: selectedSpreadsheetId,
        sheetName: selectedSheetName,
        headerPolicy: "extend",
      };

      await fetchJson(
        apiUrl(`/api/forms/${formId}/integrations/google-sheets`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        },
      );
      toast.success("設定を保存しました");
      try {
        await queryClient.invalidateQueries({
          queryKey: ["google-sheets-config", formId],
        });
      } catch (error) {
        logError("Failed to refresh config after save:", "ui", {
          error: error,
        });
        toast.error("設定の再取得に失敗しました。手動で再読み込みしてください");
      }
    } catch (error) {
      logError("Failed to save config:", "ui", { error: error });
      toast.error("設定の保存に失敗しました");
    }
  }, [formId, queryClient, selectedSpreadsheetId, selectedSheetName]);

  const spreadsheets = spreadsheetsData?.spreadsheets ?? [];
  const sheets = sheetsData?.sheets ?? [];
  const isFetchingSpreadsheets =
    isLoadingSpreadsheets || isFetchingSpreadsheetsFetching;
  const isFetchingSheets = isLoadingSheets || isFetchingSheetsFetching;
  const spreadsheetsErrorMessage =
    spreadsheetsError instanceof Error ? spreadsheetsError.message : null;
  const sheetsErrorMessage =
    sheetsError instanceof Error ? sheetsError.message : null;

  // UI選択が保存済み設定と異なるかチェック（初期化前はfalse）
  const hasUnsavedChanges =
    hasInitializedConfigRef.current &&
    savedConfig != null &&
    (selectedSpreadsheetId !== savedConfig.spreadsheetId ||
      selectedSheetName !== savedConfig.sheetName);

  // 差分同期を実行
  const handleSync = useCallback(async () => {
    if (
      !selectedSpreadsheetId ||
      !selectedSheetName ||
      !savedConfig ||
      hasUnsavedChanges ||
      isSyncing
    ) {
      toast.error("設定を保存してから同期してください");
      return;
    }

    setIsSyncing(true);
    try {
      const data = await fetchJson<SyncStartResponse>(
        apiUrl(`/api/forms/${formId}/integrations/google-sheets/sync`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      setSyncStatus({
        jobId: data.jobId,
        status: data.status,
      });
      setActiveJobId(data.jobId);
      if (syncTimeoutRef.current != null) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = window.setTimeout(() => {
        syncTimeoutRef.current = null;
        toast.error("同期状態の監視がタイムアウトしました");
        setIsSyncing(false);
        setActiveJobId(null);
        setSyncStatus(null);
      }, 60_000);

      toast.success("同期を開始しました");

      try {
        await queryClient.invalidateQueries({
          queryKey: ["google-sheets-config", formId],
        });
      } catch (error) {
        logError("Failed to refresh config after sync start:", "ui", {
          error: error,
        });
        toast.error("設定の再取得に失敗しました。手動で再読み込みしてください");
      }
    } catch (error) {
      logError("Failed to start sync:", "ui", { error: error });
      toast.error("同期の開始に失敗しました");
      setIsSyncing(false);
    }
  }, [
    formId,
    hasUnsavedChanges,
    isSyncing,
    queryClient,
    savedConfig,
    selectedSpreadsheetId,
    selectedSheetName,
  ]);

  // フィルタリングされたスプレッドシート
  const filteredSpreadsheets = useMemo(() => {
    if (!searchQuery) return spreadsheets;
    const query = searchQuery.toLowerCase();
    return spreadsheets.filter(
      (s) =>
        s.name?.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query),
    );
  }, [spreadsheets, searchQuery]);

  if (isCheckingConnection || isLoadingConfig) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Google Sheets 連携</CardTitle>
          <CardDescription>読み込み中...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Google Sheets 連携</CardTitle>
          <CardDescription>
            フォームの回答を自動的にGoogle Sheetsに同期できます
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {connectionLoadError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {connectionLoadError}
              </div>
            )}
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">
                Google
                アカウントに接続して、スプレッドシートへの書き込み権限を付与してください
              </p>
            </div>
            <Button onClick={handleConnect} className="w-full">
              <ExternalLink className="h-4 w-4 mr-2" />
              Google アカウントに接続
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Google Sheets 連携</CardTitle>
            <CardDescription>回答をGoogle Sheetsに自動同期</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" />
            <span>接続済み</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* スプレッドシート選択 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label>スプレッドシート</Label>
            <Dialog
              open={isSpreadsheetDialogOpen}
              onOpenChange={setIsSpreadsheetDialogOpen}
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
                    onChange={(e) => setNewSpreadsheetTitle(e.target.value)}
                    disabled={isCreatingSpreadsheet}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSpreadsheetDialogOpen(false)}
                    disabled={isCreatingSpreadsheet}
                  >
                    キャンセル
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreateSpreadsheet}
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
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["spreadsheets"],
                })
              }
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
                    onClick={() => handleSelectSpreadsheet(spreadsheet.id)}
                    className={[
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                      selectedSpreadsheetId === spreadsheet.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    ].join(" ")}
                  >
                    <div className="font-medium">
                      {spreadsheet.name || "無題"}
                    </div>
                    <div className="text-xs opacity-70 truncate">
                      {spreadsheet.id}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* シート選択 */}
        {selectedSpreadsheetId && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>シート</Label>
                <Dialog
                  open={isSheetDialogOpen}
                  onOpenChange={setIsSheetDialogOpen}
                >
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
                        onChange={(e) => setNewSheetTitle(e.target.value)}
                        disabled={isAddingSheet}
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsSheetDialogOpen(false)}
                        disabled={isAddingSheet}
                      >
                        キャンセル
                      </Button>
                      <Button
                        type="button"
                        onClick={handleAddSheet}
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
                <div className="text-sm text-destructive">
                  {sheetsErrorMessage}
                </div>
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
                        onClick={() => handleSelectSheet(sheet.title)}
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
          </>
        )}

        {/* 同期状態 */}
        {syncStatus && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>同期状態</Label>
                {!isSyncing && (
                  <button
                    type="button"
                    onClick={() => setSyncStatus(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="閉じる"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {syncStatus.status === "failed"
                      ? (syncStatus.error ?? "同期に失敗しました")
                      : syncStatus.status === "completed"
                        ? "同期が完了しました"
                        : syncStatus.status === "queued"
                          ? "待機中..."
                          : syncStatus.progress?.processed !== undefined ||
                              syncStatus.progress?.total !== undefined
                            ? `${syncStatus.progress.processed ?? 0} / ${syncStatus.progress.total ?? 0} 件処理中`
                            : "処理中..."}
                  </span>
                  <span className="font-medium">
                    {syncStatus.progress?.percentage !== undefined
                      ? `${syncStatus.progress.percentage}%`
                      : ""}
                  </span>
                </div>
                {syncStatus.progress?.percentage !== undefined &&
                  syncStatus.status !== "failed" && (
                    <Progress value={syncStatus.progress.percentage} />
                  )}
                {syncStatus.status === "completed" && syncStatus.result && (
                  <div className="text-xs text-muted-foreground">
                    {syncStatus.result.updatedRows !== undefined
                      ? `${syncStatus.result.updatedRows} 行を書き込みました`
                      : "同期が完了しました"}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* アクションボタン */}
        <Separator />
        <div className="flex gap-3">
          <Button
            onClick={handleSaveConfig}
            disabled={!selectedSpreadsheetId || !selectedSheetName || isSyncing}
            className="flex-1"
          >
            設定を保存
          </Button>
          <Button
            onClick={handleSync}
            disabled={
              !selectedSpreadsheetId ||
              !selectedSheetName ||
              isSyncing ||
              hasUnsavedChanges ||
              !savedConfig
            }
            variant="default"
            className="flex-1"
            title={
              hasUnsavedChanges || !savedConfig
                ? "設定を保存してから同期してください"
                : undefined
            }
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                同期中...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                今すぐ差分同期
              </>
            )}
          </Button>
        </div>

        {/* 説明 */}
        <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-2">
          <p>
            <strong>自動拡張:</strong>{" "}
            指定されたヘッダー名が存在しない場合、自動的に新しい列として追加されます。
          </p>
          <p>
            <strong>差分同期:</strong>{" "}
            前回の同期以降の新しい回答のみが追加されます。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
