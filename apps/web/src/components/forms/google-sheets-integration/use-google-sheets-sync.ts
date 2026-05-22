import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api";
import { fetchJson } from "@/lib/fetch-json";
import { logError } from "@/lib/logger";
import type {
  SyncJobStatusResponse,
  SyncStartResponse,
} from "@/types/integrations/google-sheets";
import type { UiSyncState, UiSyncStatus } from "./types";

interface SyncMonitorState {
  syncStatus: UiSyncState | null;
  isSyncing: boolean;
  activeJobId: string | null;
}

type SyncMonitorAction =
  | { type: "start"; status: UiSyncState }
  | { type: "update"; status: UiSyncState }
  | { type: "finish"; status: UiSyncState }
  | { type: "dismiss-status" }
  | { type: "clear" };

type TerminalNotification = {
  jobId: string;
  status: "completed" | "failed";
};

export type SyncStatusTransition =
  | {
      action: Extract<SyncMonitorAction, { type: "update" | "finish" }>;
      notifyStatus: "completed" | "failed" | null;
    }
  | {
      action: null;
      notifyStatus: null;
    };

const apiRequestInit = (init: RequestInit = {}): RequestInit => ({
  ...init,
  credentials: "include",
});

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

function areProgressStatesEqual(
  a: UiSyncState["progress"],
  b: UiSyncState["progress"],
): boolean {
  return (
    a?.processed === b?.processed &&
    a?.total === b?.total &&
    a?.percentage === b?.percentage
  );
}

function areResultStatesEqual(
  a: UiSyncState["result"],
  b: UiSyncState["result"],
): boolean {
  return (
    a?.updatedRows === b?.updatedRows && a?.updatedRange === b?.updatedRange
  );
}

function areSyncStatesEqual(a: UiSyncState | null, b: UiSyncState): boolean {
  return (
    a?.jobId === b.jobId &&
    a.status === b.status &&
    a.error === b.error &&
    areProgressStatesEqual(a.progress, b.progress) &&
    areResultStatesEqual(a.result, b.result)
  );
}

function isTerminalStatus(
  status: UiSyncStatus,
): status is "completed" | "failed" {
  return status === "completed" || status === "failed";
}

function hasNotifiedTerminalStatus(
  notified: TerminalNotification | null,
  status: UiSyncState,
): boolean {
  return (
    notified?.jobId === status.jobId &&
    notified.status === status.status &&
    isTerminalStatus(status.status)
  );
}

export function buildUiSyncState(
  jobData: SyncJobStatusResponse,
  activeJobId: string,
): UiSyncState {
  const uiStatus = mapBullMqStateToUiStatus(jobData.job.state);
  const jobResult = isJobResult(jobData.job.result)
    ? jobData.job.result
    : undefined;

  return {
    jobId: activeJobId,
    status: uiStatus,
    progress: extractProgress(jobData.job.progress),
    result: jobResult,
    error: uiStatus === "failed" ? jobData.job.failedReason : undefined,
  };
}

export function getSyncStatusTransition(
  previousStatus: UiSyncState | null,
  nextStatus: UiSyncState,
  notifiedTerminalStatus: TerminalNotification | null,
): SyncStatusTransition {
  if (isTerminalStatus(nextStatus.status)) {
    if (hasNotifiedTerminalStatus(notifiedTerminalStatus, nextStatus)) {
      return { action: null, notifyStatus: null };
    }
    return {
      action: { type: "finish", status: nextStatus },
      notifyStatus: nextStatus.status,
    };
  }

  if (areSyncStatesEqual(previousStatus, nextStatus)) {
    return { action: null, notifyStatus: null };
  }

  return {
    action: { type: "update", status: nextStatus },
    notifyStatus: null,
  };
}

const syncMonitorReducer = (
  state: SyncMonitorState,
  action: SyncMonitorAction,
): SyncMonitorState => {
  switch (action.type) {
    case "start":
      return {
        syncStatus: action.status,
        isSyncing: true,
        activeJobId: action.status.jobId,
      };
    case "update":
      return {
        ...state,
        syncStatus: action.status,
      };
    case "finish":
      return {
        syncStatus: action.status,
        isSyncing: false,
        activeJobId: null,
      };
    case "dismiss-status":
      return {
        ...state,
        syncStatus: null,
      };
    case "clear":
      return {
        syncStatus: null,
        isSyncing: false,
        activeJobId: null,
      };
  }
};

interface UseGoogleSheetsSyncOptions {
  formId: string;
  configQueryKey: readonly unknown[];
}

export function useGoogleSheetsSync({
  formId,
  configQueryKey,
}: UseGoogleSheetsSyncOptions) {
  const queryClient = useQueryClient();
  const [syncMonitor, dispatchSyncMonitor] = useReducer(syncMonitorReducer, {
    syncStatus: null,
    isSyncing: false,
    activeJobId: null,
  });
  const { activeJobId, isSyncing, syncStatus } = syncMonitor;
  const syncTimeoutRef = useRef<number | null>(null);
  const lastDispatchedStatusRef = useRef<UiSyncState | null>(null);
  const notifiedTerminalStatusRef = useRef<TerminalNotification | null>(null);

  const clearSyncTimeout = useCallback(() => {
    if (syncTimeoutRef.current != null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);

  const removeSyncJobQuery = useCallback(
    (jobId: string) => {
      queryClient.removeQueries({
        queryKey: ["syncJobStatus", formId, jobId],
      });
    },
    [formId, queryClient],
  );

  useEffect(() => clearSyncTimeout, [clearSyncTimeout]);

  const { data: syncJobData, error: syncJobError } = useQuery({
    queryKey: ["syncJobStatus", formId, activeJobId],
    queryFn:
      activeJobId && isSyncing
        ? () =>
            fetchJson<SyncJobStatusResponse>(
              apiUrl(
                `/api/forms/${formId}/integrations/google-sheets/sync/${activeJobId}`,
              ),
              apiRequestInit(),
            )
        : skipToken,
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

    const nextStatus = buildUiSyncState(syncJobData, activeJobId);
    const transition = getSyncStatusTransition(
      lastDispatchedStatusRef.current,
      nextStatus,
      notifiedTerminalStatusRef.current,
    );

    if (!transition.action) return;

    lastDispatchedStatusRef.current = nextStatus;
    if (transition.notifyStatus) {
      clearSyncTimeout();
      notifiedTerminalStatusRef.current = {
        jobId: nextStatus.jobId,
        status: transition.notifyStatus,
      };
      if (transition.notifyStatus === "completed") {
        toast.success("同期が完了しました");
      } else {
        toast.error("同期に失敗しました");
      }
      removeSyncJobQuery(nextStatus.jobId);
    }

    dispatchSyncMonitor(transition.action);
  }, [activeJobId, clearSyncTimeout, removeSyncJobQuery, syncJobData]);

  useEffect(() => {
    if (!syncJobError) return;
    clearSyncTimeout();
    if (activeJobId) {
      removeSyncJobQuery(activeJobId);
    }
    toast.error("同期状態の確認に失敗しました");
    lastDispatchedStatusRef.current = null;
    notifiedTerminalStatusRef.current = null;
    dispatchSyncMonitor({ type: "clear" });
  }, [activeJobId, clearSyncTimeout, removeSyncJobQuery, syncJobError]);

  const startSync = useCallback(async () => {
    const pendingStatus: UiSyncState = {
      jobId: "",
      status: "queued",
    };
    lastDispatchedStatusRef.current = pendingStatus;
    notifiedTerminalStatusRef.current = null;
    dispatchSyncMonitor({
      type: "start",
      status: pendingStatus,
    });

    try {
      const data = await fetchJson<SyncStartResponse>(
        apiUrl(`/api/forms/${formId}/integrations/google-sheets/sync`),
        apiRequestInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      const startedStatus: UiSyncState = {
        jobId: data.jobId,
        status: data.status,
      };
      lastDispatchedStatusRef.current = startedStatus;
      dispatchSyncMonitor({
        type: "start",
        status: startedStatus,
      });
      clearSyncTimeout();
      syncTimeoutRef.current = window.setTimeout(() => {
        syncTimeoutRef.current = null;
        toast.error("同期状態の監視がタイムアウトしました");
        lastDispatchedStatusRef.current = null;
        notifiedTerminalStatusRef.current = null;
        dispatchSyncMonitor({ type: "clear" });
      }, 60_000);

      toast.success("同期を開始しました");

      try {
        await queryClient.invalidateQueries({
          queryKey: configQueryKey,
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
      lastDispatchedStatusRef.current = null;
      notifiedTerminalStatusRef.current = null;
      dispatchSyncMonitor({ type: "clear" });
    }
  }, [clearSyncTimeout, configQueryKey, formId, queryClient]);

  const dismissSyncStatus = useCallback(() => {
    dispatchSyncMonitor({ type: "dismiss-status" });
  }, []);

  return {
    activeJobId,
    dismissSyncStatus,
    isSyncing,
    startSync,
    syncStatus,
  };
}
