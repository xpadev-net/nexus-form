import { ensureNodeIds, type MergePlateResult } from "@nexus-form/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorSSE } from "@/hooks/forms/use-editor-sse";
import { usePlateMerge } from "@/hooks/forms/use-plate-merge";
import { baseUrl, client, RpcError, rpc } from "@/lib/api";

interface ContentQueryData {
  plateContent: string | null;
  plateContentVersion: number;
}

interface UseFormContentAutosaveOptions {
  formId: string;
  contentData: ContentQueryData | undefined;
  contentRefetch: () => Promise<unknown>;
  getActiveTab: () => string;
}

export interface UseFormContentAutosaveReturn {
  isSaving: boolean;
  draftContent: string | null;
  isMerging: boolean;
  isMergingRef: React.MutableRefObject<boolean>;
  isConflictActiveRef: React.MutableRefObject<boolean>;
  conflictState: {
    result: MergePlateResult;
    remoteVersion: number;
  } | null;
  snapshotEditorToDraft: () => void;
  conflictResolutions: Record<string, "local" | "remote">;
  setConflictResolutions: React.Dispatch<
    React.SetStateAction<Record<string, "local" | "remote">>
  >;
  attemptMerge: () => Promise<void>;
  resolveConflicts: (
    resolutions: Record<string, "local" | "remote">,
  ) => Promise<void>;
  dismissConflict: () => void;
  handleContentChange: (value: string) => void;
  pendingValueRef: React.MutableRefObject<string | null>;
  lastSavedVersionRef: React.MutableRefObject<number | null>;
}

export function useFormContentAutosave({
  formId,
  contentData,
  contentRefetch,
  getActiveTab,
}: UseFormContentAutosaveOptions): UseFormContentAutosaveReturn {
  const queryClient = useQueryClient();

  const [isSaving, setIsSaving] = useState(false);
  const [draftContent, setDraftContent] = useState<string | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, "local" | "remote">
  >({});

  const versionRef = useRef(0);
  const baseContentRef = useRef("[]");
  const editorValueRef = useRef("[]");
  const saveTimerRef = useRef<number | null>(null);
  const pendingValueRef = useRef<string | null>(null);
  const mutateRef = useRef<
    (data: { plateContent: string; expectedVersion: number }) => void
  >(() => {});
  const lastSavedVersionRef = useRef<number | null>(null);
  const isConflictActiveRef = useRef(false);
  const refetchRef = useRef(contentRefetch);
  refetchRef.current = contentRefetch;
  const getActiveTabRef = useRef(getActiveTab);
  getActiveTabRef.current = getActiveTab;

  // Initialize refs and draft from server data
  useEffect(() => {
    if (!contentData) return;
    versionRef.current = contentData.plateContentVersion;
    const raw = contentData.plateContent ?? "[]";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        ensureNodeIds(parsed);
        baseContentRef.current = JSON.stringify(parsed);
      } else {
        baseContentRef.current = raw;
      }
    } catch {
      baseContentRef.current = raw;
    }
    editorValueRef.current = baseContentRef.current;
    setDraftContent(baseContentRef.current);
  }, [contentData]);

  const handleMergeSuccess = useCallback(
    (mergedContent: string, newVersion: number, mergeLocalContent: string) => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingValueRef.current = null;
      isConflictActiveRef.current = false;
      versionRef.current = newVersion;
      baseContentRef.current = mergedContent;
      lastSavedVersionRef.current = newVersion;
      const hasInFlightTyping = editorValueRef.current !== mergeLocalContent;
      void queryClient.invalidateQueries({ queryKey: ["formDiff", formId] });
      if (!hasInFlightTyping) {
        editorValueRef.current = mergedContent;
        queryClient.setQueryData(["formContent", formId], {
          plateContent: mergedContent,
          plateContentVersion: newVersion,
        });
        setIsSaving(false);
      } else {
        const inFlightValue = editorValueRef.current;
        pendingValueRef.current = inFlightValue;
        saveTimerRef.current = window.setTimeout(() => {
          const pendingValue = pendingValueRef.current;
          saveTimerRef.current = null;
          if (pendingValue == null) return;
          pendingValueRef.current = null;
          mutateRef.current({
            plateContent: pendingValue,
            expectedVersion: versionRef.current,
          });
        }, 2000);
      }
    },
    [formId, queryClient],
  );

  const handleConflict = useCallback(() => {
    isConflictActiveRef.current = true;
    setIsSaving(false);
    if (getActiveTabRef.current() !== "editor") {
      toast.warning("編集が競合しています。エディタタブで解決してください。");
    }
  }, []);

  const handleMergeFallback = useCallback(() => {
    isConflictActiveRef.current = false;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingValueRef.current = null;
    void refetchRef.current();
    setIsSaving(false);
  }, []);

  const getCurrentEditorValue = useCallback(() => editorValueRef.current, []);
  const setCurrentEditorValue = useCallback((value: string) => {
    editorValueRef.current = value;
  }, []);

  const {
    attemptMerge,
    resolveConflicts,
    dismissConflict,
    isMerging,
    isMergingRef,
    conflictState,
  } = usePlateMerge({
    formId,
    baseContentRef,
    getCurrentEditorValue,
    setCurrentEditorValue,
    onMergeSuccess: handleMergeSuccess,
    onConflict: handleConflict,
    onMergeFallback: handleMergeFallback,
  });

  // Reset resolutions when a new conflict arrives
  useEffect(() => {
    if (conflictState) {
      setConflictResolutions({});
    }
  }, [conflictState]);

  // SSE integration
  useEditorSSE(formId, {
    pendingValueRef,
    lastSavedVersionRef,
    onMergeNeeded: attemptMerge,
    isConflictActiveRef,
  });

  // Content save mutation
  const contentMutation = useMutation({
    mutationFn: (data: { plateContent: string; expectedVersion: number }) =>
      rpc(
        client.api.forms[":id"].content.$put({
          param: { id: formId },
          json: data,
        }),
      ),
    onSuccess: (data, variables) => {
      if (data && "plateContentVersion" in data) {
        versionRef.current = data.plateContentVersion;
        baseContentRef.current = variables.plateContent;
        lastSavedVersionRef.current = data.plateContentVersion;
      }
      void queryClient.invalidateQueries({ queryKey: ["formDiff", formId] });
      setIsSaving(false);
    },
    onError: (err) => {
      setIsSaving(false);
      lastSavedVersionRef.current = null;
      if (err instanceof RpcError && err.status === 409) {
        void attemptMerge();
      } else {
        toast.error("保存に失敗しました");
      }
    },
  });

  mutateRef.current = contentMutation.mutate;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally stable — all values read through refs
  const handleContentChange = useCallback((value: string) => {
    editorValueRef.current = value;
    if (isConflictActiveRef.current || isMergingRef.current) {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        pendingValueRef.current = null;
      }
      return;
    }
    if (value === baseContentRef.current && pendingValueRef.current == null) {
      return;
    }
    setIsSaving(true);
    pendingValueRef.current = value;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (isMergingRef.current || isConflictActiveRef.current) {
        saveTimerRef.current = null;
        return;
      }
      const pendingValue = pendingValueRef.current;
      saveTimerRef.current = null;
      if (pendingValue == null) return;
      pendingValueRef.current = null;
      lastSavedVersionRef.current = versionRef.current + 1;
      mutateRef.current({
        plateContent: pendingValue,
        expectedVersion: versionRef.current,
      });
    }, 2000);
  }, []);

  // Unmount: clear timer and best-effort save via keepalive fetch
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (pendingValueRef.current != null) {
        const body = JSON.stringify({
          plateContent: pendingValueRef.current,
          expectedVersion: versionRef.current,
        });
        const KEEPALIVE_LIMIT = 64 * 1024;
        if (new Blob([body]).size <= KEEPALIVE_LIMIT) {
          fetch(`${baseUrl}/api/forms/${formId}/content`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            keepalive: true,
            body,
          }).catch(() => {
            try {
              localStorage.setItem(`pendingSave:${formId}`, body);
            } catch {
              // localStorage も利用不可の場合は諦める
            }
          });
        } else {
          try {
            localStorage.setItem(`pendingSave:${formId}`, body);
          } catch {
            // localStorage も利用不可の場合は諦める
          }
        }
      }
    };
  }, [formId]);

  // On mount: retry any pending save from localStorage using rpc()
  useEffect(() => {
    const key = `pendingSave:${formId}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    localStorage.removeItem(key);
    let parsed: { plateContent: string; expectedVersion: number };
    try {
      parsed = JSON.parse(saved) as {
        plateContent: string;
        expectedVersion: number;
      };
    } catch {
      return;
    }
    rpc(
      client.api.forms[":id"].content.$put({
        param: { id: formId },
        json: parsed,
      }),
    )
      .then(() => {
        toast.success("前回未保存の変更を復元しました");
        void queryClient.invalidateQueries({
          queryKey: ["formContent", formId],
        });
      })
      .catch(() => {
        try {
          localStorage.setItem(key, saved);
        } catch {
          // 諦める
        }
      });
  }, [formId, queryClient]);

  return {
    isSaving,
    draftContent,
    isMerging,
    isMergingRef,
    isConflictActiveRef,
    conflictState,
    conflictResolutions,
    setConflictResolutions,
    attemptMerge,
    resolveConflicts,
    dismissConflict,
    handleContentChange,
    pendingValueRef,
    lastSavedVersionRef,
    snapshotEditorToDraft: () => setDraftContent(editorValueRef.current),
  };
}
