import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
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
import type { Sheet, Spreadsheet } from "./google-sheets-integration/types";
import { useGoogleSheetsSync } from "./google-sheets-integration/use-google-sheets-sync";

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

interface GoogleSheetsUiState {
  searchQuery: string;
  selectedSpreadsheetId: string;
  selectedSheetName: string;
  isSpreadsheetDialogOpen: boolean;
  newSpreadsheetTitle: string;
  isCreatingSpreadsheet: boolean;
  isSheetDialogOpen: boolean;
  newSheetTitle: string;
  isAddingSheet: boolean;
}

type GoogleSheetsUiAction =
  | { type: "set-search-query"; value: string }
  | { type: "initialize-config"; config: GoogleSheetsIntegrationSetting }
  | { type: "select-spreadsheet"; spreadsheetId: string }
  | { type: "select-sheet"; sheetName: string }
  | { type: "set-spreadsheet-dialog-open"; open: boolean }
  | { type: "set-new-spreadsheet-title"; title: string }
  | { type: "set-creating-spreadsheet"; isCreating: boolean }
  | {
      type: "complete-create-spreadsheet";
      spreadsheetId: string;
      sheetName: string;
    }
  | { type: "set-sheet-dialog-open"; open: boolean }
  | { type: "set-new-sheet-title"; title: string }
  | { type: "set-adding-sheet"; isAdding: boolean }
  | { type: "close-sheet-dialog" }
  | { type: "complete-add-sheet"; sheetName: string };

const initialGoogleSheetsUiState: GoogleSheetsUiState = {
  searchQuery: "",
  selectedSpreadsheetId: "",
  selectedSheetName: "",
  isSpreadsheetDialogOpen: false,
  newSpreadsheetTitle: "",
  isCreatingSpreadsheet: false,
  isSheetDialogOpen: false,
  newSheetTitle: "",
  isAddingSheet: false,
};

const googleSheetsUiReducer = (
  state: GoogleSheetsUiState,
  action: GoogleSheetsUiAction,
): GoogleSheetsUiState => {
  switch (action.type) {
    case "set-search-query":
      return { ...state, searchQuery: action.value };
    case "initialize-config":
      return {
        ...state,
        selectedSpreadsheetId:
          action.config.spreadsheetId ?? state.selectedSpreadsheetId,
        selectedSheetName: action.config.sheetName ?? state.selectedSheetName,
      };
    case "select-spreadsheet":
      return {
        ...state,
        selectedSpreadsheetId: action.spreadsheetId,
        selectedSheetName: "",
      };
    case "select-sheet":
      return { ...state, selectedSheetName: action.sheetName };
    case "set-spreadsheet-dialog-open":
      return { ...state, isSpreadsheetDialogOpen: action.open };
    case "set-new-spreadsheet-title":
      return { ...state, newSpreadsheetTitle: action.title };
    case "set-creating-spreadsheet":
      return { ...state, isCreatingSpreadsheet: action.isCreating };
    case "complete-create-spreadsheet":
      return {
        ...state,
        isSpreadsheetDialogOpen: false,
        newSpreadsheetTitle: "",
        selectedSpreadsheetId: action.spreadsheetId,
        selectedSheetName: action.sheetName,
      };
    case "set-sheet-dialog-open":
      return { ...state, isSheetDialogOpen: action.open };
    case "set-new-sheet-title":
      return { ...state, newSheetTitle: action.title };
    case "set-adding-sheet":
      return { ...state, isAddingSheet: action.isAdding };
    case "close-sheet-dialog":
      return {
        ...state,
        isSheetDialogOpen: false,
        newSheetTitle: "",
      };
    case "complete-add-sheet":
      return {
        ...state,
        selectedSheetName: action.sheetName,
      };
    default:
      return state;
  }
};

function useGoogleSheetsIntegrationModel(formId: string) {
  const queryClient = useQueryClient();

  const [uiState, dispatchUi] = useReducer(
    googleSheetsUiReducer,
    initialGoogleSheetsUiState,
  );
  const {
    searchQuery,
    selectedSpreadsheetId,
    selectedSheetName,
    isSpreadsheetDialogOpen,
    newSpreadsheetTitle,
    isCreatingSpreadsheet,
    isSheetDialogOpen,
    newSheetTitle,
    isAddingSheet,
  } = uiState;
  const searchQueryRef = useRef(searchQuery);

  // 同期状態
  const { dismissSyncStatus, isSyncing, startSync, syncStatus } =
    useGoogleSheetsSync({
      formId,
      configQueryKey: ["google-sheets-config", formId],
    });

  const authWindowRef = useRef<Window | null>(null);
  const popupIntervalRef = useRef<number | null>(null);
  const hasInitializedConfigRef = useRef(false);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

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

    dispatchUi({ type: "initialize-config", config: savedConfig });
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

  const handleSearchQueryChange = useCallback((value: string) => {
    dispatchUi({ type: "set-search-query", value });
  }, []);

  const handleSpreadsheetDialogOpenChange = useCallback((open: boolean) => {
    dispatchUi({ type: "set-spreadsheet-dialog-open", open });
  }, []);

  const handleNewSpreadsheetTitleChange = useCallback((title: string) => {
    dispatchUi({ type: "set-new-spreadsheet-title", title });
  }, []);

  // スプレッドシート選択時
  const handleSelectSpreadsheet = useCallback(
    (spreadsheetId: string) => {
      dispatchUi({ type: "select-spreadsheet", spreadsheetId });
      void queryClient.invalidateQueries({
        queryKey: ["sheets", spreadsheetId],
      });
    },
    [queryClient],
  );

  // シート選択時の処理
  const handleSelectSheet = useCallback((sheetName: string) => {
    dispatchUi({ type: "select-sheet", sheetName });
  }, []);

  const handleSheetDialogOpenChange = useCallback((open: boolean) => {
    dispatchUi({ type: "set-sheet-dialog-open", open });
  }, []);

  const handleNewSheetTitleChange = useCallback((title: string) => {
    dispatchUi({ type: "set-new-sheet-title", title });
  }, []);

  const handleCreateSpreadsheet = useCallback(async () => {
    const title = newSpreadsheetTitle.trim();
    if (!title) {
      toast.error("スプレッドシート名を入力してください");
      return;
    }

    dispatchUi({ type: "set-creating-spreadsheet", isCreating: true });
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
      dispatchUi({
        type: "complete-create-spreadsheet",
        spreadsheetId: data.spreadsheetId,
        sheetName: data.defaultSheetTitle || "",
      });
      await queryClient.invalidateQueries({ queryKey: ["spreadsheets"] });
      void queryClient.invalidateQueries({
        queryKey: ["sheets", data.spreadsheetId],
      });
    } catch (error) {
      logError("Failed to create spreadsheet:", "ui", { error: error });
      toast.error("スプレッドシートの作成に失敗しました");
    } finally {
      dispatchUi({ type: "set-creating-spreadsheet", isCreating: false });
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

    dispatchUi({ type: "set-adding-sheet", isAdding: true });
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
      dispatchUi({ type: "close-sheet-dialog" });
      await queryClient.invalidateQueries({
        queryKey: ["sheets", selectedSpreadsheetId],
      });
      dispatchUi({
        type: "complete-add-sheet",
        sheetName: data.title || title,
      });
    } catch (error) {
      logError("Failed to add sheet:", "ui", { error: error });
      toast.error("シートの追加に失敗しました");
    } finally {
      dispatchUi({ type: "set-adding-sheet", isAdding: false });
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

    await startSync();
  }, [
    hasUnsavedChanges,
    isSyncing,
    savedConfig,
    selectedSpreadsheetId,
    selectedSheetName,
    startSync,
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

  const handleRefreshSpreadsheets = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["spreadsheets"],
    });
  }, [queryClient]);

  const handleCreateSpreadsheetClick = useCallback(() => {
    void handleCreateSpreadsheet();
  }, [handleCreateSpreadsheet]);

  const handleAddSheetClick = useCallback(() => {
    void handleAddSheet();
  }, [handleAddSheet]);

  const handleClearSyncStatus = useCallback(() => {
    dismissSyncStatus();
  }, [dismissSyncStatus]);

  const handleSaveConfigClick = useCallback(() => {
    void handleSaveConfig();
  }, [handleSaveConfig]);

  const handleSyncClick = useCallback(() => {
    void handleSync();
  }, [handleSync]);

  return {
    connectionLoadError,
    filteredSpreadsheets,
    handleAddSheetClick,
    handleClearSyncStatus,
    handleConnect,
    handleCreateSpreadsheetClick,
    handleNewSheetTitleChange,
    handleNewSpreadsheetTitleChange,
    handleRefreshSpreadsheets,
    handleSaveConfigClick,
    handleSearchQueryChange,
    handleSelectSheet,
    handleSelectSpreadsheet,
    handleSheetDialogOpenChange,
    handleSpreadsheetDialogOpenChange,
    handleSyncClick,
    hasUnsavedChanges,
    isAddingSheet,
    isCheckingConnection,
    isConnected,
    isCreatingSpreadsheet,
    isFetchingSheets,
    isFetchingSpreadsheets,
    isLoadingConfig,
    isSheetDialogOpen,
    isSpreadsheetDialogOpen,
    isSyncing,
    newSheetTitle,
    newSpreadsheetTitle,
    savedConfig,
    searchQuery,
    selectedSheetName,
    selectedSpreadsheetId,
    sheets,
    sheetsErrorMessage,
    spreadsheetsErrorMessage,
    syncStatus,
  } as const;
}

export function GoogleSheetsIntegration({
  formId,
  className,
}: GoogleSheetsIntegrationProps) {
  const model = useGoogleSheetsIntegrationModel(formId);

  if (model.isCheckingConnection || model.isLoadingConfig) {
    return <GoogleSheetsLoadingCard className={className} />;
  }

  if (!model.isConnected) {
    return (
      <GoogleSheetsDisconnectedCard
        className={className}
        connectionLoadError={model.connectionLoadError}
        onConnect={model.handleConnect}
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
          searchQuery={model.searchQuery}
          selectedSpreadsheetId={model.selectedSpreadsheetId}
          filteredSpreadsheets={model.filteredSpreadsheets}
          isFetchingSpreadsheets={model.isFetchingSpreadsheets}
          spreadsheetsErrorMessage={model.spreadsheetsErrorMessage}
          isSpreadsheetDialogOpen={model.isSpreadsheetDialogOpen}
          newSpreadsheetTitle={model.newSpreadsheetTitle}
          isCreatingSpreadsheet={model.isCreatingSpreadsheet}
          onSearchQueryChange={model.handleSearchQueryChange}
          onRefreshSpreadsheets={model.handleRefreshSpreadsheets}
          onSelectSpreadsheet={model.handleSelectSpreadsheet}
          onSpreadsheetDialogOpenChange={
            model.handleSpreadsheetDialogOpenChange
          }
          onNewSpreadsheetTitleChange={model.handleNewSpreadsheetTitleChange}
          onCreateSpreadsheet={model.handleCreateSpreadsheetClick}
        />

        {model.selectedSpreadsheetId && (
          <>
            <Separator />
            <SheetSelector
              selectedSheetName={model.selectedSheetName}
              sheets={model.sheets}
              isFetchingSheets={model.isFetchingSheets}
              sheetsErrorMessage={model.sheetsErrorMessage}
              isSheetDialogOpen={model.isSheetDialogOpen}
              newSheetTitle={model.newSheetTitle}
              isAddingSheet={model.isAddingSheet}
              onSelectSheet={model.handleSelectSheet}
              onSheetDialogOpenChange={model.handleSheetDialogOpenChange}
              onNewSheetTitleChange={model.handleNewSheetTitleChange}
              onAddSheet={model.handleAddSheetClick}
            />
          </>
        )}

        {model.syncStatus && (
          <>
            <Separator />
            <SyncStatusPanel
              syncStatus={model.syncStatus}
              isSyncing={model.isSyncing}
              onClearSyncStatus={model.handleClearSyncStatus}
            />
          </>
        )}

        <Separator />
        <SyncActionButtons
          selectedSpreadsheetId={model.selectedSpreadsheetId}
          selectedSheetName={model.selectedSheetName}
          isSyncing={model.isSyncing}
          hasUnsavedChanges={model.hasUnsavedChanges}
          hasSavedConfig={Boolean(model.savedConfig)}
          onSaveConfig={model.handleSaveConfigClick}
          onSync={model.handleSyncClick}
        />

        <GoogleSheetsSyncDescription />
      </CardContent>
    </Card>
  );
}
