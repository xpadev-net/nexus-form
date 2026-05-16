import { ensureNodeIds, type MergePlateResult } from "@nexus-form/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useEditorSSE } from "@/hooks/forms/use-editor-sse";
import { usePlateMerge } from "@/hooks/forms/use-plate-merge";
import { baseUrl, client, RpcError, rpc } from "@/lib/api";

const pendingSaveSchema = z.object({
  plateContent: z.string(),
  expectedVersion: z.number().int(),
});

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
  const inFlightValueRef = useRef<string | null>(null);
  const mutateRef = useRef<
    (data: { plateContent: string; expectedVersion: number }) => void
  >(() => {});
  const lastSavedVersionRef = useRef<number | null>(null);
  const isConflictActiveRef = useRef(false);
  const refetchRef = useRef(contentRefetch);
  refetchRef.current = contentRefetch;
  const getActiveTabRef = useRef(getActiveTab);
  getActiveTabRef.current = getActiveTab;

  // Initialize refs and draft from server data.
  // Guard: if the editor has unsaved local edits, only update version and
  // baseContent — do NOT overwrite the live editor value or draft. This
  // prevents background refetches (window-focus, invalidation) from silently
  // discarding in-progress typing.
  useEffect(() => {
    if (!contentData) return;
    versionRef.current = contentData.plateContentVersion;
    const raw = contentData.plateContent ?? "[]";
    let canonical: string;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        ensureNodeIds(parsed);
        canonical = JSON.stringify(parsed);
      } else {
        canonical = raw;
      }
    } catch {
      canonical = raw;
    }
    const hasLocalEdits =
      editorValueRef.current !== baseContentRef.current ||
      pendingValueRef.current != null;
    baseContentRef.current = canonical;
    if (!hasLocalEdits) {
      editorValueRef.current = canonical;
      setDraftContent(canonical);
    }
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
          inFlightValueRef.current = pendingValue;
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
    // Align editorValueRef with baseContentRef so the init effect correctly
    // resets the editor to server content after the upcoming refetch.
    editorValueRef.current = baseContentRef.current;
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
      inFlightValueRef.current = null;
      if (data && "plateContentVersion" in data) {
        versionRef.current = data.plateContentVersion;
        baseContentRef.current = variables.plateContent;
        lastSavedVersionRef.current = data.plateContentVersion;
      }
      void queryClient.invalidateQueries({ queryKey: ["formDiff", formId] });
      setIsSaving(false);
    },
    onError: (err) => {
      inFlightValueRef.current = null;
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
      inFlightValueRef.current = pendingValue;
      pendingValueRef.current = null;
      lastSavedVersionRef.current = versionRef.current + 1;
      mutateRef.current({
        plateContent: pendingValue,
        expectedVersion: versionRef.current,
      });
    }, 2000);
  }, []);

  // Unmount: clear timer and best-effort save via keepalive fetch.
  // Check both pendingValueRef (debounce not yet fired) and inFlightValueRef
  // (mutation already started but not yet confirmed) to avoid losing saves
  // when the component unmounts immediately after the timer fires.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      const valueToSave = pendingValueRef.current ?? inFlightValueRef.current;
      if (valueToSave != null) {
        const body = JSON.stringify({
          plateContent: valueToSave,
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
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(saved);
    } catch {
      return;
    }
    const result = pendingSaveSchema.safeParse(rawParsed);
    if (!result.success) return;
    rpc(
      client.api.forms[":id"].content.$put({
        param: { id: formId },
        json: result.data,
      }),
    )
      .then(() => {
        toast.success("前回未保存の変更を復元しました");
        void queryClient.invalidateQueries({
          queryKey: ["formContent", formId],
        });
      })
      .catch((err) => {
        // 409 = server already has a newer version; discard the stale entry
        if (err instanceof RpcError && err.status === 409) return;
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
