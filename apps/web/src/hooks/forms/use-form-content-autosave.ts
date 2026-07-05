import { ensureNodeIds, type MergePlateResult } from "@nexus-form/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import { resolveServerContentSync } from "@/hooks/forms/form-content-autosave-sync";
import { formDiffQueryKey } from "@/hooks/forms/form-structure-query-keys";
import { useEditorSSE } from "@/hooks/forms/use-editor-sse";
import { usePlateMerge } from "@/hooks/forms/use-plate-merge";
import {
  baseUrl,
  client,
  getShareTokenAuthorizationHeader,
  RpcError,
  rpc,
} from "@/lib/api";

const pendingSaveSchema = z.object({
  authScope: z.object({
    principalKey: z.string(),
    role: z.enum(["EDITOR", "VIEWER"]),
    type: z.enum(["session", "share-token"]),
  }),
  failureStatus: z.number().int().optional(),
  failureType: z.enum(["http", "network", "unknown"]).optional(),
  formId: z.string(),
  plateContent: z.string(),
  expectedVersion: z.number().int(),
  retryBlocked: z.literal("conflict").optional(),
  source: z.literal("in-flight").optional(),
});

const KEEPALIVE_LIMIT = 64 * 1024;
const IN_FLIGHT_FALLBACK_RETRY_DELAY_MS = 1000;

export type PendingSave = z.infer<typeof pendingSaveSchema>;
export type PendingSaveAuthScope = PendingSave["authScope"];

function fingerprintPrincipal(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function getShareTokenFromCurrentUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URL(window.location.href).searchParams.get("shareToken");
  } catch {
    return null;
  }
}

function buildPendingSaveAuthScope(enabled: boolean): PendingSaveAuthScope {
  const shareToken = getShareTokenFromCurrentUrl();
  return {
    principalKey: shareToken
      ? fingerprintPrincipal(shareToken)
      : "current-session",
    role: enabled ? "EDITOR" : "VIEWER",
    type: shareToken ? "share-token" : "session",
  };
}

function arePendingSaveAuthScopesEqual(
  a: PendingSaveAuthScope,
  b: PendingSaveAuthScope,
): boolean {
  return (
    a.principalKey === b.principalKey && a.role === b.role && a.type === b.type
  );
}

function parsePendingSave(body: string): PendingSave | null {
  try {
    const result = pendingSaveSchema.safeParse(JSON.parse(body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function readCurrentPendingSave(
  formId: string,
): { body: string; data: PendingSave } | null {
  try {
    const body = localStorage.getItem(`pendingSave:${formId}`);
    if (!body) return null;
    const data = parsePendingSave(body);
    return data ? { body, data } : null;
  } catch {
    return null;
  }
}

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

function shouldPreserveExistingPendingSave(
  formId: string,
  authScope: PendingSaveAuthScope,
): boolean {
  const existing = readCurrentPendingSave(formId);
  return (
    existing?.data.retryBlocked === "conflict" ||
    (existing != null &&
      !arePendingSaveAuthScopesEqual(existing.data.authScope, authScope))
  );
}

function storeScopedPendingSave(
  formId: string,
  authScope: PendingSaveAuthScope,
  body: string,
) {
  try {
    if (shouldPreserveExistingPendingSave(formId, authScope)) return;
  } catch {
    // If the existing entry cannot be inspected, replace it with the recoverable save.
  }
  storePendingSave(formId, body);
}

function clearPendingSaveForAuthScope(
  formId: string,
  authScope: PendingSaveAuthScope,
) {
  const existing = readCurrentPendingSave(formId);
  if (!existing) {
    clearPendingSave(formId);
    return;
  }
  if (
    existing.data.formId === formId &&
    arePendingSaveAuthScopesEqual(existing.data.authScope, authScope)
  ) {
    clearPendingSave(formId);
  }
}

function clearResolvedPendingSave(
  formId: string,
  savedContent: {
    authScope: PendingSaveAuthScope;
    expectedVersion: number;
    plateContent: string;
  },
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
  const pendingSave = parsePendingSave(saved);
  if (!pendingSave) {
    clearPendingSave(formId);
    return;
  }
  if (
    pendingSave.formId === formId &&
    arePendingSaveAuthScopesEqual(
      pendingSave.authScope,
      savedContent.authScope,
    ) &&
    pendingSave.expectedVersion === savedContent.expectedVersion &&
    pendingSave.plateContent === savedContent.plateContent
  ) {
    clearPendingSave(formId);
  }
}

function storeInFlightPendingSave(
  formId: string,
  save: {
    authScope: PendingSaveAuthScope;
    expectedVersion: number;
    plateContent: string;
  },
) {
  try {
    if (shouldPreserveExistingPendingSave(formId, save.authScope)) return;
  } catch {
    // If the existing entry cannot be inspected, replace it with the recoverable in-flight save.
  }
  storePendingSave(
    formId,
    JSON.stringify({
      ...save,
      formId,
      source: "in-flight",
    }),
  );
}

function buildPendingSaveBody(
  formId: string,
  save: {
    authScope: PendingSaveAuthScope;
    expectedVersion: number;
    failureStatus?: number;
    failureType?: PendingSave["failureType"];
    plateContent: string;
    retryBlocked?: "conflict";
    source?: "in-flight";
  },
): string {
  return JSON.stringify({
    ...save,
    formId,
  });
}

function areQueryKeysEqual(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

interface ContentQueryData {
  plateContent: string | null;
  plateContentVersion: number;
}

interface ContentSaveInput {
  authScope: PendingSaveAuthScope;
  contentQueryKey: readonly unknown[];
  formId: string;
  plateContent: string;
  expectedVersion: number;
  restoreGeneration: number;
}

interface UseFormContentAutosaveOptions {
  formId: string;
  contentData: ContentQueryData | undefined;
  contentQueryKey?: readonly unknown[];
  contentRefetch: () => Promise<unknown>;
  getActiveTab: () => string;
  enabled?: boolean;
  enableRealtimeSync?: boolean;
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
  contentQueryKey: providedContentQueryKey,
  contentRefetch,
  getActiveTab,
  enabled = true,
  enableRealtimeSync = false,
}: UseFormContentAutosaveOptions): UseFormContentAutosaveReturn {
  const queryClient = useQueryClient();
  const contentQueryKey = useMemo(
    () => providedContentQueryKey ?? ["formContent", formId],
    [formId, providedContentQueryKey],
  );

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
  const inFlightExpectedVersionRef = useRef<number | null>(null);
  const restoreGenerationRef = useRef(0);
  const suspendAutosaveRef = useRef(false);
  const enabledRef = useRef(enabled);
  const contentQueryKeyRef = useRef(contentQueryKey);
  const formIdRef = useRef(formId);
  const authScopeRef = useRef(buildPendingSaveAuthScope(enabled));
  const mutateRef = useRef<(data: ContentSaveInput) => void>(() => {});
  const lastSavedVersionRef = useRef<number | null>(null);
  const isConflictActiveRef = useRef(false);
  const refetchRef = useRef(contentRefetch);
  refetchRef.current = contentRefetch;
  const getActiveTabRef = useRef(getActiveTab);
  getActiveTabRef.current = getActiveTab;
  enabledRef.current = enabled;
  contentQueryKeyRef.current = contentQueryKey;
  formIdRef.current = formId;
  authScopeRef.current = buildPendingSaveAuthScope(enabled);

  const enqueueContentSave = useCallback(
    (
      input: Omit<ContentSaveInput, "authScope" | "contentQueryKey" | "formId">,
    ) => {
      mutateRef.current({
        ...input,
        authScope: authScopeRef.current,
        contentQueryKey,
        formId,
      });
    },
    [contentQueryKey, formId],
  );

  const enqueueCurrentContentSave = useCallback(
    (
      input: Omit<ContentSaveInput, "authScope" | "contentQueryKey" | "formId">,
    ) => {
      mutateRef.current({
        ...input,
        authScope: authScopeRef.current,
        contentQueryKey: contentQueryKeyRef.current,
        formId: formIdRef.current,
      });
    },
    [],
  );

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
      void queryClient.invalidateQueries({
        queryKey: formDiffQueryKey(formId),
      });
      if (!hasInFlightTyping) {
        editorValueRef.current = mergedContent;
        queryClient.setQueryData(contentQueryKey, {
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
          pendingValueRef.current = null;
          lastSavedVersionRef.current = saveBaseVersion + 1;
          inFlightExpectedVersionRef.current = saveBaseVersion;
          enqueueContentSave({
            plateContent: pendingValue,
            expectedVersion: saveBaseVersion,
            restoreGeneration: restoreGenerationRef.current,
          });
        }, 2000);
      }
    },
    [contentQueryKey, enqueueContentSave, formId, queryClient],
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
    if (!enabled) return false;
    return (
      editorValueRef.current !== baseContentRef.current ||
      pendingValueRef.current != null ||
      inFlightValueRef.current != null
    );
  }, [enabled]);

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
      lastSavedVersionRef.current = saveBaseVersion + 1;
      inFlightExpectedVersionRef.current = saveBaseVersion;
      enqueueContentSave({
        plateContent: valueToSave,
        expectedVersion: saveBaseVersion,
        restoreGeneration: restoreGenerationRef.current,
      });
    }, 2000);
  }, [
    canonicalizePlateContent,
    contentData,
    enqueueContentSave,
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
      inFlightExpectedVersionRef.current = null;
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
    enabled: enableRealtimeSync,
    pendingValueRef,
    lastSavedVersionRef,
    onMergeNeeded: attemptMerge,
    isConflictActiveRef,
  });

  // Content save mutation
  const contentMutation = useMutation({
    mutationFn: ({
      expectedVersion,
      formId: saveFormId,
      plateContent,
    }: ContentSaveInput) =>
      rpc(
        client.api.forms[":id"].content.$put({
          param: { id: saveFormId },
          json: { plateContent, expectedVersion },
        }),
      ),
    onSuccess: (data, variables) => {
      clearResolvedPendingSave(variables.formId, {
        authScope: variables.authScope,
        expectedVersion: variables.expectedVersion,
        plateContent: variables.plateContent,
      });
      const isCurrentSaveScope =
        variables.formId === formIdRef.current &&
        areQueryKeysEqual(
          variables.contentQueryKey,
          contentQueryKeyRef.current,
        );
      if (
        isCurrentSaveScope &&
        variables.restoreGeneration !== restoreGenerationRef.current
      ) {
        return;
      }
      if (data && "plateContentVersion" in data) {
        queryClient.setQueryData(variables.contentQueryKey, {
          plateContent: variables.plateContent,
          plateContentVersion: data.plateContentVersion,
        });
      }
      void queryClient.invalidateQueries({
        queryKey: formDiffQueryKey(variables.formId),
      });
      if (!isCurrentSaveScope) return;
      inFlightValueRef.current = null;
      inFlightExpectedVersionRef.current = null;
      if (data && "plateContentVersion" in data) {
        versionRef.current = data.plateContentVersion;
        baseContentRef.current = variables.plateContent;
        lastSavedVersionRef.current = data.plateContentVersion;
        pendingRemoteContentRef.current = null;
        pendingRemoteVersionRef.current = null;
      }
      setIsSaving(false);
    },
    onError: (err, variables) => {
      if (variables.formId !== formIdRef.current) {
        return;
      }
      if (
        !areQueryKeysEqual(
          variables.contentQueryKey,
          contentQueryKeyRef.current,
        )
      ) {
        return;
      }
      if (variables.restoreGeneration !== restoreGenerationRef.current) return;
      inFlightValueRef.current = null;
      inFlightExpectedVersionRef.current = null;
      setIsSaving(false);
      lastSavedVersionRef.current = null;
      if (
        err instanceof RpcError &&
        (err.status === 401 || err.status === 403)
      ) {
        clearPendingSave(variables.formId);
      } else if (err instanceof RpcError && err.status === 409) {
        void attemptMerge();
      } else {
        toast.error("保存に失敗しました");
      }
    },
  });

  mutateRef.current = contentMutation.mutate;

  useEffect(() => {
    if (enabled) return;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingValueRef.current = null;
    inFlightValueRef.current = null;
    inFlightExpectedVersionRef.current = null;
    setIsSaving(false);
  }, [enabled]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally stable — all values read through refs
  const handleContentChange = useCallback(
    (value: string) => {
      if (!enabledRef.current) return;
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
        pendingValueRef.current = null;
        const saveBaseVersion = versionRef.current;
        lastSavedVersionRef.current = saveBaseVersion + 1;
        inFlightExpectedVersionRef.current = saveBaseVersion;
        enqueueCurrentContentSave({
          plateContent: pendingValue,
          expectedVersion: saveBaseVersion,
          restoreGeneration: restoreGenerationRef.current,
        });
      }, 2000);
    },
    [enqueueCurrentContentSave],
  );

  const flushPendingSaveOnExit = useCallback(
    (
      targetFormId: string,
      shouldFlush: boolean,
      authScope: PendingSaveAuthScope,
    ) => {
      if (!shouldFlush) return;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const valueToSave = pendingValueRef.current;
      if (valueToSave == null && inFlightValueRef.current != null) {
        storeInFlightPendingSave(targetFormId, {
          authScope,
          plateContent: inFlightValueRef.current,
          expectedVersion:
            inFlightExpectedVersionRef.current ?? versionRef.current,
        });
        inFlightValueRef.current = null;
        inFlightExpectedVersionRef.current = null;
        editorValueRef.current = baseContentRef.current;
        return;
      }
      if (valueToSave == null) return;
      pendingValueRef.current = null;
      inFlightValueRef.current = null;
      inFlightExpectedVersionRef.current = null;
      editorValueRef.current = baseContentRef.current;

      // Pending content is newer than any in-flight content, so it is the
      // only fallback stored when both refs are set.
      const keepaliveVersion = versionRef.current;
      const body = JSON.stringify({
        authScope,
        formId: targetFormId,
        plateContent: valueToSave,
        expectedVersion: keepaliveVersion,
      });
      if (new Blob([body]).size <= KEEPALIVE_LIMIT) {
        fetch(`${baseUrl}/api/forms/${targetFormId}/content`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...getShareTokenAuthorizationHeader(),
          },
          credentials: "include",
          keepalive: true,
          body,
        })
          .then((response) => {
            if (response.ok) {
              clearResolvedPendingSave(targetFormId, {
                authScope,
                expectedVersion: keepaliveVersion,
                plateContent: valueToSave,
              });
            } else if (response.status === 401 || response.status === 403) {
              clearPendingSaveForAuthScope(targetFormId, authScope);
            } else {
              storeScopedPendingSave(
                targetFormId,
                authScope,
                buildPendingSaveBody(targetFormId, {
                  authScope,
                  expectedVersion: keepaliveVersion,
                  failureStatus: response.status,
                  failureType: "http",
                  plateContent: valueToSave,
                }),
              );
            }
          })
          .catch(() => {
            storeScopedPendingSave(
              targetFormId,
              authScope,
              buildPendingSaveBody(targetFormId, {
                authScope,
                expectedVersion: keepaliveVersion,
                failureType: "network",
                plateContent: valueToSave,
              }),
            );
          });
      } else {
        storeScopedPendingSave(targetFormId, authScope, body);
      }
    },
    [],
  );

  // Unmount/form switch: clear timer and best-effort save via keepalive fetch.
  // Only save pendingValueRef (debounce not yet fired).
  // Do NOT send inFlightValueRef via keepalive: the regular autosave PUT is
  // already in flight for that value, and a duplicate keepalive PUT with the
  // same expectedVersion would produce a 409 that incorrectly creates a
  // pending save entry for already-saved content. Store it locally instead so
  // normal success can clear the fallback, while failed/aborted navigation can
  // retry it on the next mount.
  useEffect(() => {
    const cleanupFormId = formId;
    const cleanupEnabled = enabled;
    const cleanupAuthScope = buildPendingSaveAuthScope(enabled);
    return () => {
      const isSameMountedForm = formIdRef.current === cleanupFormId;
      const isEnabledOnlyCleanup =
        isSameMountedForm && enabledRef.current !== cleanupEnabled;
      if (isEnabledOnlyCleanup) {
        if (cleanupEnabled && !enabledRef.current) {
          flushPendingSaveOnExit(cleanupFormId, true, cleanupAuthScope);
          setIsSaving(false);
        }
        return;
      }
      flushPendingSaveOnExit(cleanupFormId, cleanupEnabled, cleanupAuthScope);
      if (!isSameMountedForm) {
        setIsSaving(false);
      }
    };
  }, [enabled, flushPendingSaveOnExit, formId]);

  // On mount: retry any pending save from localStorage using rpc()
  useEffect(() => {
    if (!enabled) return;
    const currentAuthScope = buildPendingSaveAuthScope(enabled);
    const saved = readCurrentPendingSave(formId);
    if (!saved) {
      clearPendingSave(formId);
      return;
    }
    if (
      saved.data.formId !== formId ||
      !arePendingSaveAuthScopesEqual(saved.data.authScope, currentAuthScope)
    ) {
      clearPendingSave(formId);
      return;
    }
    if (saved.data.retryBlocked === "conflict") return;
    const retryPendingSave = async (pendingSaveBody: string): Promise<void> => {
      const retryPending = parsePendingSave(pendingSaveBody);
      if (!retryPending) {
        clearPendingSave(formId);
        return;
      }
      if (
        retryPending.formId !== formId ||
        !arePendingSaveAuthScopesEqual(retryPending.authScope, currentAuthScope)
      ) {
        clearPendingSave(formId);
        return;
      }
      const retryPayload = {
        expectedVersion: retryPending.expectedVersion,
        plateContent: retryPending.plateContent,
      };
      clearPendingSave(formId);
      inFlightValueRef.current = retryPayload.plateContent;
      inFlightExpectedVersionRef.current = retryPayload.expectedVersion;
      storeInFlightPendingSave(formId, {
        ...retryPayload,
        authScope: currentAuthScope,
      });
      try {
        await rpc(
          client.api.forms[":id"].content.$put({
            param: { id: formId },
            json: retryPayload,
          }),
        );
        clearResolvedPendingSave(formId, {
          ...retryPayload,
          authScope: currentAuthScope,
        });
        toast.success("前回未保存の変更を復元しました");
        void queryClient.invalidateQueries({
          queryKey: contentQueryKey,
        });
        void queryClient.invalidateQueries({
          queryKey: formDiffQueryKey(formId),
        });
      } catch (err) {
        if (err instanceof RpcError && err.status === 409) {
          storePendingSave(
            formId,
            buildPendingSaveBody(formId, {
              ...retryPayload,
              authScope: currentAuthScope,
              retryBlocked: "conflict",
            }),
          );
          toast.warning("前回未保存の変更が競合しています");
          return;
        }
        if (
          err instanceof RpcError &&
          (err.status === 401 || err.status === 403)
        ) {
          clearPendingSave(formId);
          return;
        }
        const currentPendingSave = readCurrentPendingSave(formId);
        if (!currentPendingSave) {
          storePendingSave(
            formId,
            buildPendingSaveBody(formId, {
              ...retryPayload,
              authScope: currentAuthScope,
              failureStatus: err instanceof RpcError ? err.status : undefined,
              failureType: err instanceof RpcError ? "http" : "unknown",
            }),
          );
          return;
        }
        if (
          currentPendingSave.data.formId === formId &&
          arePendingSaveAuthScopesEqual(
            currentPendingSave.data.authScope,
            currentAuthScope,
          ) &&
          currentPendingSave.data.retryBlocked !== "conflict" &&
          currentPendingSave.data.expectedVersion ===
            retryPayload.expectedVersion &&
          currentPendingSave.data.plateContent === retryPayload.plateContent
        ) {
          storePendingSave(
            formId,
            buildPendingSaveBody(formId, {
              ...retryPayload,
              authScope: currentAuthScope,
              failureStatus: err instanceof RpcError ? err.status : undefined,
              failureType: err instanceof RpcError ? "http" : "unknown",
            }),
          );
        }
      } finally {
        if (
          inFlightExpectedVersionRef.current === retryPayload.expectedVersion &&
          inFlightValueRef.current === retryPayload.plateContent
        ) {
          inFlightValueRef.current = null;
          inFlightExpectedVersionRef.current = null;
        }
      }
    };
    if (saved.data.source !== "in-flight") {
      void retryPendingSave(saved.body);
      return;
    }
    const retryTimer = window.setTimeout(() => {
      const currentPendingSave = readCurrentPendingSave(formId);
      if (!currentPendingSave) {
        clearPendingSave(formId);
        return;
      }
      if (
        currentPendingSave.data.source !== "in-flight" ||
        currentPendingSave.data.retryBlocked === "conflict" ||
        currentPendingSave.data.formId !== formId ||
        !arePendingSaveAuthScopesEqual(
          currentPendingSave.data.authScope,
          currentAuthScope,
        ) ||
        currentPendingSave.data.expectedVersion !==
          saved.data.expectedVersion ||
        currentPendingSave.data.plateContent !== saved.data.plateContent
      ) {
        return;
      }
      void retryPendingSave(currentPendingSave.body);
    }, IN_FLIGHT_FALLBACK_RETRY_DELAY_MS);
    return () => {
      window.clearTimeout(retryTimer);
    };
  }, [contentQueryKey, enabled, formId, queryClient]);

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
