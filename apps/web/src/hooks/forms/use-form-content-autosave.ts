import { ensureNodeIds, type MergePlateResult } from "@nexus-form/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import { resolveServerContentSync } from "@/hooks/forms/form-content-autosave-sync";
import { useEditorSSE } from "@/hooks/forms/use-editor-sse";
import { usePlateMerge } from "@/hooks/forms/use-plate-merge";
import { baseUrl, client, RpcError, rpc } from "@/lib/api";

const pendingSaveSchema = z.object({
  plateContent: z.string(),
  expectedVersion: z.number().int(),
  retryBlocked: z.literal("conflict").optional(),
});

const KEEPALIVE_LIMIT = 64 * 1024;

function storePendingSave(formId: string, body: string) {
  try {
    localStorage.setItem(`pendingSave:${formId}`, body);
  } catch {
    // localStorage も利用不可の場合は諦める
  }
}

function clearPendingSave(formId: string) {
  try {
    localStorage.removeItem(`pendingSave:${formId}`);
  } catch {
    // localStorage も利用不可の場合は諦める
  }
}

function clearResolvedPendingSave(
  formId: string,
  savedContent: { expectedVersion: number; plateContent: string },
) {
  const key = `pendingSave:${formId}`;
  let saved: string | null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    clearPendingSave(formId);
    return;
  }
  if (!saved) return;
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(saved);
  } catch {
    clearPendingSave(formId);
    return;
  }
  const result = pendingSaveSchema.safeParse(rawParsed);
  if (!result.success) {
    clearPendingSave(formId);
    return;
  }
  if (
    result.data.expectedVersion === savedContent.expectedVersion &&
    result.data.plateContent === savedContent.plateContent
  ) {
    clearPendingSave(formId);
  }
}

interface ContentQueryData {
  plateContent: string | null;
  plateContentVersion: number;
}

interface ContentSaveInput {
  plateContent: string;
  expectedVersion: number;
  restoreGeneration: number;
}

interface InFlightAutosave {
  plateContent: string;
  expectedVersion: number;
  restoreGeneration: number;
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
  conflictState: {
    result: MergePlateResult;
    remoteVersion: number;
  } | null;
  snapshotEditorToDraft: () => void;
  conflictResolutions: Record<string, "local" | "remote">;
  setConflictResolutions: React.Dispatch<
    React.SetStateAction<Record<string, "local" | "remote">>
  >;
  resolveConflicts: (
    resolutions: Record<string, "local" | "remote">,
  ) => Promise<void>;
  dismissConflict: () => void;
  handleContentChange: (value: string) => void;
  hasUnsavedLocalEdits: () => boolean;
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
  // Written when collaborator content arrives during local edits (R12-P6).
  // Merge still refetches via usePlateMerge; these refs reserve the payload for a
  // future optimization and are cleared on save/merge success.
  const pendingRemoteContentRef = useRef<string | null>(null);
  const pendingRemoteVersionRef = useRef<number | null>(null);
  const editorValueRef = useRef("[]");
  const saveTimerRef = useRef<number | null>(null);
  const pendingValueRef = useRef<string | null>(null);
  const inFlightValueRef = useRef<string | null>(null);
  const inFlightRequestRef = useRef<InFlightAutosave | null>(null);
  const restoreGenerationRef = useRef(0);
  const suspendAutosaveRef = useRef(false);
  const keepaliveSentRef = useRef<{
    generation: number;
    version: number;
    plateContent: string;
  } | null>(null);
  const keepaliveCoveredRequestRef = useRef<InFlightAutosave | null>(null);
  const mutateRef = useRef<(data: ContentSaveInput) => void>(() => {});
  const lastSavedVersionRef = useRef<number | null>(null);
  const isConflictActiveRef = useRef(false);
  const refetchRef = useRef(contentRefetch);
  refetchRef.current = contentRefetch;
  const getActiveTabRef = useRef(getActiveTab);
  getActiveTabRef.current = getActiveTab;

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
      pendingRemoteContentRef.current = null;
      pendingRemoteVersionRef.current = null;
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
        const saveBaseVersion = versionRef.current;
        saveTimerRef.current = window.setTimeout(() => {
          const pendingValue = pendingValueRef.current;
          saveTimerRef.current = null;
          if (pendingValue == null) return;
          inFlightValueRef.current = pendingValue;
          inFlightRequestRef.current = {
            plateContent: pendingValue,
            expectedVersion: saveBaseVersion,
            restoreGeneration: restoreGenerationRef.current,
          };
          pendingValueRef.current = null;
          lastSavedVersionRef.current = saveBaseVersion + 1;
          mutateRef.current({
            plateContent: pendingValue,
            expectedVersion: saveBaseVersion,
            restoreGeneration: restoreGenerationRef.current,
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
    resetMergeState,
  } = usePlateMerge({
    formId,
    baseContentRef,
    getCurrentEditorValue,
    setCurrentEditorValue,
    onMergeSuccess: handleMergeSuccess,
    onConflict: handleConflict,
    onMergeFallback: handleMergeFallback,
  });

  const canonicalizePlateContent = useCallback((raw: string): string => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        ensureNodeIds(parsed);
        return JSON.stringify(parsed);
      }
      return raw;
    } catch {
      return raw;
    }
  }, []);

  const hasUnsavedLocalEdits = useCallback((): boolean => {
    return (
      editorValueRef.current !== baseContentRef.current ||
      pendingValueRef.current != null ||
      inFlightValueRef.current != null
    );
  }, []);

  // Initialize refs and draft from server data.
  // When local edits are pending, keep versionRef/baseContentRef on the last
  // saved ancestor so autosave uses the correct expectedVersion (R12-P6).
  useEffect(() => {
    if (!contentData) return;
    const canonical = canonicalizePlateContent(
      contentData.plateContent ?? "[]",
    );
    const hasLocalEdits = hasUnsavedLocalEdits();

    const syncResult = resolveServerContentSync({
      hasLocalEdits,
      serverVersion: contentData.plateContentVersion,
      serverCanonical: canonical,
      versionRef: versionRef.current,
      baseContentRef: baseContentRef.current,
    });

    if (syncResult.action === "stash-remote") {
      pendingRemoteContentRef.current = syncResult.remoteCanonical;
      pendingRemoteVersionRef.current = syncResult.remoteVersion;
    } else if (syncResult.action === "apply-server") {
      versionRef.current = syncResult.version;
      baseContentRef.current = syncResult.canonical;
      editorValueRef.current = syncResult.canonical;
      setDraftContent(syncResult.canonical);
      pendingRemoteContentRef.current = null;
      pendingRemoteVersionRef.current = null;
    }

    if (!suspendAutosaveRef.current) return;
    suspendAutosaveRef.current = false;
    const pendingValue = pendingValueRef.current;
    if (
      pendingValue == null ||
      pendingValue === baseContentRef.current ||
      isConflictActiveRef.current ||
      isMergingRef.current
    ) {
      if (pendingValue === baseContentRef.current) {
        pendingValueRef.current = null;
        setIsSaving(false);
      }
      return;
    }
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (isMergingRef.current || isConflictActiveRef.current) {
        saveTimerRef.current = null;
        return;
      }
      const valueToSave = pendingValueRef.current;
      saveTimerRef.current = null;
      if (valueToSave == null) return;
      inFlightValueRef.current = valueToSave;
      pendingValueRef.current = null;
      const saveBaseVersion = versionRef.current;
      inFlightRequestRef.current = {
        plateContent: valueToSave,
        expectedVersion: saveBaseVersion,
        restoreGeneration: restoreGenerationRef.current,
      };
      keepaliveSentRef.current = null;
      lastSavedVersionRef.current = saveBaseVersion + 1;
      mutateRef.current({
        plateContent: valueToSave,
        expectedVersion: saveBaseVersion,
        restoreGeneration: restoreGenerationRef.current,
      });
    }, 2000);
  }, [
    canonicalizePlateContent,
    contentData,
    hasUnsavedLocalEdits,
    isMergingRef,
  ]);

  useEffect(() => {
    const handleRestoreEdit = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          formId?: string;
          plateContent?: string;
        }>
      ).detail;
      if (detail?.formId !== formId) return;
      const restoredContent = detail.plateContent ?? baseContentRef.current;

      restoreGenerationRef.current++;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingValueRef.current = null;
      inFlightValueRef.current = null;
      inFlightRequestRef.current = null;
      keepaliveSentRef.current = null;
      keepaliveCoveredRequestRef.current = null;
      lastSavedVersionRef.current = null;
      isConflictActiveRef.current = false;
      suspendAutosaveRef.current = true;
      resetMergeState();
      setConflictResolutions({});
      baseContentRef.current = restoredContent;
      editorValueRef.current = restoredContent;
      setDraftContent(restoredContent);
      setIsSaving(false);
    };

    window.addEventListener(RESTORE_EDIT_EVENT, handleRestoreEdit);
    return () => {
      window.removeEventListener(RESTORE_EDIT_EVENT, handleRestoreEdit);
    };
  }, [formId, resetMergeState]);

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
    mutationFn: ({ plateContent, expectedVersion }: ContentSaveInput) =>
      rpc(
        client.api.forms[":id"].content.$put({
          param: { id: formId },
          json: { plateContent, expectedVersion },
        }),
      ),
    onSuccess: (data, variables) => {
      const shouldClearKeepaliveSent =
        keepaliveSentRef.current != null &&
        keepaliveSentRef.current.version === variables.expectedVersion &&
        keepaliveSentRef.current.generation === variables.restoreGeneration &&
        keepaliveSentRef.current.plateContent === variables.plateContent;
      if (shouldClearKeepaliveSent) {
        keepaliveSentRef.current = null;
      }
      const inFlightRequest = inFlightRequestRef.current;
      if (
        inFlightRequest != null &&
        (inFlightRequest.restoreGeneration !== variables.restoreGeneration ||
          inFlightRequest.expectedVersion !== variables.expectedVersion ||
          inFlightRequest.plateContent !== variables.plateContent)
      ) {
        clearResolvedPendingSave(formId, {
          expectedVersion: variables.expectedVersion,
          plateContent: variables.plateContent,
        });
        return;
      }
      if (variables.restoreGeneration < restoreGenerationRef.current) {
        inFlightValueRef.current = null;
        inFlightRequestRef.current = null;
        clearResolvedPendingSave(formId, {
          expectedVersion: variables.expectedVersion,
          plateContent: variables.plateContent,
        });
        return;
      }
      clearResolvedPendingSave(formId, {
        expectedVersion: variables.expectedVersion,
        plateContent: variables.plateContent,
      });
      inFlightValueRef.current = null;
      inFlightRequestRef.current = null;
      if (data && "plateContentVersion" in data) {
        versionRef.current = data.plateContentVersion;
        baseContentRef.current = variables.plateContent;
        lastSavedVersionRef.current = data.plateContentVersion;
        pendingRemoteContentRef.current = null;
        pendingRemoteVersionRef.current = null;
        queryClient.setQueryData(["formContent", formId], {
          plateContent: variables.plateContent,
          plateContentVersion: data.plateContentVersion,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["formDiff", formId] });
      setIsSaving(false);
    },
    onError: (err, variables) => {
      if (
        keepaliveCoveredRequestRef.current != null &&
        keepaliveCoveredRequestRef.current.expectedVersion ===
          variables.expectedVersion &&
        keepaliveCoveredRequestRef.current.restoreGeneration ===
          variables.restoreGeneration &&
        keepaliveCoveredRequestRef.current.plateContent ===
          variables.plateContent
      ) {
        inFlightValueRef.current = null;
        inFlightRequestRef.current = null;
        setIsSaving(false);
        keepaliveCoveredRequestRef.current = null;
        return;
      }
      if (
        keepaliveSentRef.current != null &&
        keepaliveSentRef.current.version === variables.expectedVersion &&
        keepaliveSentRef.current.generation === variables.restoreGeneration &&
        keepaliveSentRef.current.plateContent === variables.plateContent
      ) {
        inFlightValueRef.current = null;
        inFlightRequestRef.current = null;
        setIsSaving(false);
        keepaliveSentRef.current = null;
        return;
      }
      const inFlightRequest = inFlightRequestRef.current;
      if (
        inFlightRequest != null &&
        (inFlightRequest.restoreGeneration !== variables.restoreGeneration ||
          inFlightRequest.expectedVersion !== variables.expectedVersion ||
          inFlightRequest.plateContent !== variables.plateContent)
      ) {
        return;
      }
      if (variables.restoreGeneration < restoreGenerationRef.current) {
        inFlightValueRef.current = null;
        inFlightRequestRef.current = null;
        return;
      }
      inFlightValueRef.current = null;
      inFlightRequestRef.current = null;
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
    if (suspendAutosaveRef.current) {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      return;
    }
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
      inFlightRequestRef.current = {
        plateContent: pendingValue,
        expectedVersion: versionRef.current,
        restoreGeneration: restoreGenerationRef.current,
      };
      keepaliveSentRef.current = null;
      keepaliveCoveredRequestRef.current = null;
      pendingValueRef.current = null;
      const saveBaseVersion = versionRef.current;
      lastSavedVersionRef.current = saveBaseVersion + 1;
      mutateRef.current({
        plateContent: pendingValue,
        expectedVersion: saveBaseVersion,
        restoreGeneration: restoreGenerationRef.current,
      });
    }, 2000);
  }, []);

  // Unmount/pagehide: clear timer and best-effort save via keepalive fetch.
  // Fall back both pendingValueRef (not yet fired) and inFlightValueRef
  // (mutation in progress) so navigation/unload does not lose drafts.
  useEffect(() => {
    const persistPendingOrInFlightSave = () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      const pendingValue = pendingValueRef.current;
      const inFlightRequest = inFlightRequestRef.current;
      const fallbackValue =
        pendingValue != null ? pendingValue : inFlightRequest?.plateContent;
      const fallbackVersion =
        pendingValue != null
          ? versionRef.current
          : inFlightRequest?.expectedVersion;
      if (fallbackValue == null || fallbackVersion == null) return;
      pendingValueRef.current = null;
      inFlightValueRef.current = null;
      inFlightRequestRef.current = null;
      const shouldTrackKeepalive = inFlightRequest != null;
      const keepaliveGeneration = shouldTrackKeepalive
        ? restoreGenerationRef.current
        : null;
      if (shouldTrackKeepalive && keepaliveGeneration != null) {
        keepaliveSentRef.current = {
          generation: keepaliveGeneration,
          version: fallbackVersion,
          plateContent: fallbackValue,
        };
      }

      const pendingBody = () =>
        JSON.stringify({
          plateContent: fallbackValue,
          expectedVersion:
            versionRef.current === fallbackVersion
              ? fallbackVersion
              : versionRef.current,
        });
      const body = JSON.stringify({
        plateContent: fallbackValue,
        expectedVersion: fallbackVersion,
      });
      if (new Blob([body]).size <= KEEPALIVE_LIMIT) {
        Promise.resolve(
          fetch(`${baseUrl}/api/forms/${formId}/content`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            keepalive: true,
            body,
          }),
        )
          .then((response) => {
            if (response?.ok) {
              if (versionRef.current === fallbackVersion) {
                versionRef.current = fallbackVersion + 1;
                baseContentRef.current = fallbackValue;
                lastSavedVersionRef.current = fallbackVersion + 1;
                keepaliveCoveredRequestRef.current = inFlightRequest;
                clearResolvedPendingSave(formId, {
                  expectedVersion: fallbackVersion,
                  plateContent: fallbackValue,
                });
              }
              return;
            } else if (baseContentRef.current === fallbackValue) {
              // Regular autosave already saved this content; do not write a duplicate fallback.
              keepaliveSentRef.current = null;
            } else {
              keepaliveSentRef.current = null;
              storePendingSave(formId, pendingBody());
            }
          })
          .catch(() => {
            keepaliveSentRef.current = null;
            storePendingSave(formId, pendingBody());
          });
      } else {
        storePendingSave(formId, body);
        keepaliveSentRef.current = null;
      }
    };

    const handlePageHide = () => {
      persistPendingOrInFlightSave();
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        (inFlightRequestRef.current != null || pendingValueRef.current != null)
      ) {
        persistPendingOrInFlightSave();
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      persistPendingOrInFlightSave();
    };
  }, [formId]);

  // On mount: retry any pending save from localStorage using rpc()
  useEffect(() => {
    const key = `pendingSave:${formId}`;
    let saved: string | null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      clearPendingSave(formId);
      return;
    }
    if (!saved) return;
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(saved);
    } catch {
      clearPendingSave(formId);
      return;
    }
    const result = pendingSaveSchema.safeParse(rawParsed);
    if (!result.success) {
      clearPendingSave(formId);
      return;
    }
    if (result.data.retryBlocked === "conflict") return;
    clearPendingSave(formId);
    const retryPayload = {
      expectedVersion: result.data.expectedVersion,
      plateContent: result.data.plateContent,
    };
    rpc(
      client.api.forms[":id"].content.$put({
        param: { id: formId },
        json: retryPayload,
      }),
    )
      .then(() => {
        toast.success("前回未保存の変更を復元しました");
        void queryClient.invalidateQueries({
          queryKey: ["formContent", formId],
        });
        void queryClient.invalidateQueries({ queryKey: ["formDiff", formId] });
      })
      .catch((err) => {
        if (err instanceof RpcError && err.status === 409) {
          storePendingSave(
            formId,
            JSON.stringify({ ...retryPayload, retryBlocked: "conflict" }),
          );
          toast.warning("前回未保存の変更が競合しています");
          return;
        }
        storePendingSave(formId, saved);
      });
  }, [formId, queryClient]);

  return {
    isSaving,
    draftContent,
    isMerging,
    conflictState,
    conflictResolutions,
    setConflictResolutions,
    resolveConflicts,
    dismissConflict,
    handleContentChange,
    snapshotEditorToDraft: () => setDraftContent(editorValueRef.current),
    hasUnsavedLocalEdits,
  };
}
