import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiUrl, baseUrl } from "@/lib/api";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { logError } from "@/lib/logger";
import type {
  FormIntegrationResponse,
  GoogleSheetsIntegrationSetting,
  SyncJobStatusResponse,
  SyncStartResponse,
} from "@/types/integrations/google-sheets";
import {
  GoogleSheetsDisconnectedCard,
  GoogleSheetsLoadingCard,
} from "./google-sheets-integration/connection-card";
import { SheetSelector } from "./google-sheets-integration/sheet-selector";
import { SpreadsheetSelector } from "./google-sheets-integration/spreadsheet-selector";
import {
  GoogleSheetsSyncDescription,
  SyncActionButtons,
  SyncStatusPanel,
} from "./google-sheets-integration/sync-panel";
import type {
  Sheet,
  Spreadsheet,
  UiSyncState,
  UiSyncStatus,
} from "./google-sheets-integration/types";

interface GoogleSheetsIntegrationProps {
  formId: string;
  className?: string;
}

interface GoogleOAuthMessage {
  source: "google-oauth";
  status: "success" | "error";
  message?: string;
  state?: string | null;
}

const apiRequestInit = (init: RequestInit = {}): RequestInit => ({
  ...init,
  credentials: "include",
});

const isGoogleOAuthMessage = (value: unknown): value is GoogleOAuthMessage => {
  if (!isRecord(value)) return false;
  return (
    value.source === "google-oauth" &&
    (value.status === "success" || value.status === "error")
  );
};

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
  const [activeJobId, setActiveJobId] = useReducer(
    (_current: string | null, next: string | null) => next,
    null,
  );

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
        apiRequestInit(),
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
        apiRequestInit(),
      ),
    refetchOnWindowFocus: false,
  });

  const { data: savedConfig, isLoading: isLoadingConfig } = useQuery({
    queryKey: ["google-sheets-config", formId],
    queryFn: async () => {
      try {
        const data = await fetchJson<FormIntegrationResponse>(
          apiUrl(`/api/forms/${formId}/integrations/google-sheets`),
          apiRequestInit(),
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
        apiRequestInit(),
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
        apiRequestInit(),
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
      const authorizeUrl = new URL(
        apiUrl("/api/integrations/google/authorize"),
      );
      authorizeUrl.searchParams.set("app_origin", window.location.origin);

      const authWindow = window.open(
        authorizeUrl.toString(),
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
    const allowedMessageOrigins = new Set([
      window.location.origin,
      new URL(baseUrl).origin,
    ]);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!allowedMessageOrigins.has(event.origin)) return;
      if (event.source !== authWindowRef.current) return;
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
      }>(
        apiUrl("/api/integrations/google/spreadsheets"),
        apiRequestInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }),
      );
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
        apiRequestInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }),
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
        apiRequestInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }),
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
        apiRequestInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
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
    return <GoogleSheetsLoadingCard className={className} />;
  }

  if (!isConnected) {
    return (
      <GoogleSheetsDisconnectedCard
        className={className}
        connectionLoadError={connectionLoadError}
        onConnect={handleConnect}
      />
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
        <SpreadsheetSelector
          searchQuery={searchQuery}
          selectedSpreadsheetId={selectedSpreadsheetId}
          filteredSpreadsheets={filteredSpreadsheets}
          isFetchingSpreadsheets={isFetchingSpreadsheets}
          spreadsheetsErrorMessage={spreadsheetsErrorMessage}
          isSpreadsheetDialogOpen={isSpreadsheetDialogOpen}
          newSpreadsheetTitle={newSpreadsheetTitle}
          isCreatingSpreadsheet={isCreatingSpreadsheet}
          onSearchQueryChange={setSearchQuery}
          onRefreshSpreadsheets={() =>
            void queryClient.invalidateQueries({
              queryKey: ["spreadsheets"],
            })
          }
          onSelectSpreadsheet={handleSelectSpreadsheet}
          onSpreadsheetDialogOpenChange={setIsSpreadsheetDialogOpen}
          onNewSpreadsheetTitleChange={setNewSpreadsheetTitle}
          onCreateSpreadsheet={() => void handleCreateSpreadsheet()}
        />

        {selectedSpreadsheetId && (
          <>
            <Separator />
            <SheetSelector
              selectedSheetName={selectedSheetName}
              sheets={sheets}
              isFetchingSheets={isFetchingSheets}
              sheetsErrorMessage={sheetsErrorMessage}
              isSheetDialogOpen={isSheetDialogOpen}
              newSheetTitle={newSheetTitle}
              isAddingSheet={isAddingSheet}
              onSelectSheet={handleSelectSheet}
              onSheetDialogOpenChange={setIsSheetDialogOpen}
              onNewSheetTitleChange={setNewSheetTitle}
              onAddSheet={() => void handleAddSheet()}
            />
          </>
        )}

        {syncStatus && (
          <>
            <Separator />
            <SyncStatusPanel
              syncStatus={syncStatus}
              isSyncing={isSyncing}
              onClearSyncStatus={() => setSyncStatus(null)}
            />
          </>
        )}

        <Separator />
        <SyncActionButtons
          selectedSpreadsheetId={selectedSpreadsheetId}
          selectedSheetName={selectedSheetName}
          isSyncing={isSyncing}
          hasUnsavedChanges={hasUnsavedChanges}
          hasSavedConfig={Boolean(savedConfig)}
          onSaveConfig={() => void handleSaveConfig()}
          onSync={() => void handleSync()}
        />

        <GoogleSheetsSyncDescription />
      </CardContent>
    </Card>
  );
}
