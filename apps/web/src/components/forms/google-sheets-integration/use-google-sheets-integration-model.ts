import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { logError } from "@/lib/logger";
import type {
  FormIntegrationResponse,
  GoogleSheetsIntegrationSetting,
} from "@/types/integrations/google-sheets";
import { apiRequestInit } from "./api-request-init";
import {
  type Sheet,
  SPREADSHEET_SELECTOR_RESULT_LIMIT,
  type Spreadsheet,
  type UiSyncState,
} from "./types";
import { useGoogleOAuth } from "./use-google-oauth";
import { useGoogleSheetsSync } from "./use-google-sheets-sync";

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

export interface GoogleSheetsIntegrationModel {
  connectionLoadError: string | null;
  filteredSpreadsheets: Spreadsheet[];
  handleConnect: () => void;
  handleAddSheetClick: () => void;
  handleClearSyncStatus: () => void;
  handleCreateSpreadsheetClick: () => void;
  handleNewSheetTitleChange: (title: string) => void;
  handleNewSpreadsheetTitleChange: (title: string) => void;
  handleRefreshSpreadsheets: () => void;
  handleSaveConfigClick: () => void;
  handleSearchQueryChange: (value: string) => void;
  handleSelectSheet: (sheetName: string) => void;
  handleSelectSpreadsheet: (spreadsheetId: string) => void;
  handleSheetDialogOpenChange: (open: boolean) => void;
  handleSpreadsheetDialogOpenChange: (open: boolean) => void;
  handleSyncClick: () => void;
  hasUnsavedChanges: boolean;
  isAddingSheet: boolean;
  isCheckingConnection: boolean;
  isConnected: boolean;
  isCreatingSpreadsheet: boolean;
  isFetchingSheets: boolean;
  isFetchingSpreadsheets: boolean;
  isLoadingConfig: boolean;
  isSheetDialogOpen: boolean;
  isSpreadsheetDialogOpen: boolean;
  isSyncing: boolean;
  newSheetTitle: string;
  newSpreadsheetTitle: string;
  savedConfig: GoogleSheetsIntegrationSetting | null | undefined;
  searchQuery: string;
  selectedSpreadsheetName: string | undefined;
  selectedSheetName: string;
  selectedSpreadsheetId: string;
  currentLinkedSpreadsheetId: string;
  currentLinkedSpreadsheetName: string | undefined;
  sheets: Sheet[];
  sheetsErrorMessage: string | null;
  spreadsheetsErrorMessage: string | null;
  syncStatus: UiSyncState | null;
}

export function useGoogleSheetsIntegrationModel(formId: string) {
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

  const configQueryKey = useMemo(
    () => ["google-sheets-config", formId] as const,
    [formId],
  );
  const { dismissSyncStatus, isSyncing, startSync, syncStatus } =
    useGoogleSheetsSync({
      formId,
      configQueryKey,
    });

  const hasInitializedConfigRef = useRef(false);
  const knownSpreadsheetNamesRef = useRef(new Map<string, string>());
  const { handleConnect } = useGoogleOAuth({ queryClient });

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
  const isConnected = Boolean(connectionData) && !isUnauthorized;
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
      const params = new URLSearchParams({
        pageSize: String(SPREADSHEET_SELECTOR_RESULT_LIMIT + 1),
      });
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

  const handleSearchQueryChange = useCallback((value: string) => {
    dispatchUi({ type: "set-search-query", value });
  }, []);

  const handleSpreadsheetDialogOpenChange = useCallback((open: boolean) => {
    dispatchUi({ type: "set-spreadsheet-dialog-open", open });
  }, []);

  const handleNewSpreadsheetTitleChange = useCallback((title: string) => {
    dispatchUi({ type: "set-new-spreadsheet-title", title });
  }, []);

  const handleSelectSpreadsheet = useCallback(
    (spreadsheetId: string) => {
      dispatchUi({ type: "select-spreadsheet", spreadsheetId });
      void queryClient.invalidateQueries({
        queryKey: ["sheets", spreadsheetId],
      });
    },
    [queryClient],
  );

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

  const hasUnsavedChanges =
    hasInitializedConfigRef.current &&
    savedConfig != null &&
    (selectedSpreadsheetId !== savedConfig.spreadsheetId ||
      selectedSheetName !== savedConfig.sheetName);

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

  const filteredSpreadsheets = useMemo(() => {
    if (!searchQuery) return spreadsheetsData?.spreadsheets ?? [];

    const query = searchQuery.toLowerCase();
    return (spreadsheetsData?.spreadsheets ?? []).filter(
      (s) =>
        s.name?.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query),
    );
  }, [spreadsheetsData?.spreadsheets, searchQuery]);

  useEffect(() => {
    for (const spreadsheet of spreadsheetsData?.spreadsheets ?? []) {
      const name = spreadsheet.name?.trim();
      if (name) knownSpreadsheetNamesRef.current.set(spreadsheet.id, name);
    }
  }, [spreadsheetsData?.spreadsheets]);

  const selectedSpreadsheetName = useMemo(() => {
    const visibleName = spreadsheetsData?.spreadsheets
      .find((spreadsheet) => spreadsheet.id === selectedSpreadsheetId)
      ?.name?.trim();

    return (
      visibleName || knownSpreadsheetNamesRef.current.get(selectedSpreadsheetId)
    );
  }, [spreadsheetsData?.spreadsheets, selectedSpreadsheetId]);

  const currentLinkedSpreadsheetId = savedConfig?.spreadsheetId ?? "";
  const currentLinkedSpreadsheetName = useMemo(() => {
    const visibleName = spreadsheetsData?.spreadsheets
      .find((spreadsheet) => spreadsheet.id === currentLinkedSpreadsheetId)
      ?.name?.trim();

    return (
      visibleName ||
      knownSpreadsheetNamesRef.current.get(currentLinkedSpreadsheetId)
    );
  }, [currentLinkedSpreadsheetId, spreadsheetsData?.spreadsheets]);

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
    handleConnect,
    handleAddSheetClick,
    handleClearSyncStatus,
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
    isFetchingSheets: isLoadingSheets || isFetchingSheetsFetching,
    isFetchingSpreadsheets:
      isLoadingSpreadsheets || isFetchingSpreadsheetsFetching,
    isLoadingConfig,
    isSheetDialogOpen,
    isSpreadsheetDialogOpen,
    isSyncing,
    newSheetTitle,
    newSpreadsheetTitle,
    savedConfig,
    searchQuery,
    selectedSpreadsheetName,
    selectedSheetName,
    selectedSpreadsheetId,
    currentLinkedSpreadsheetId,
    currentLinkedSpreadsheetName,
    sheets: sheetsData?.sheets ?? [],
    sheetsErrorMessage:
      sheetsError instanceof Error ? sheetsError.message : null,
    spreadsheetsErrorMessage:
      spreadsheetsError instanceof Error ? spreadsheetsError.message : null,
    syncStatus,
  } as const;
}
