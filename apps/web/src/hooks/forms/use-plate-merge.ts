import type { MergePlateResult } from "@nexus-form/shared";
import {
  applyConflictResolutions,
  mergePlateContent,
} from "@nexus-form/shared";
import type { MutableRefObject } from "react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { client, RpcError, rpc } from "@/lib/api";

const MAX_MERGE_RETRIES = 3;

interface ConflictState {
  result: MergePlateResult;
  remoteVersion: number;
  generation: number;
}

interface UsePlateMergeOptions {
  formId: string;
  /** The last server-confirmed content (common ancestor for 3-way merge) */
  baseContentRef: MutableRefObject<string>;
  /** Get the current editor value (the local changes) */
  getCurrentEditorValue: () => string;
  /** Update the editor value ref (used to preserve conflict resolution on retry) */
  setCurrentEditorValue: (value: string) => void;
  /** Called after a successful auto-merge (no conflicts) */
  onMergeSuccess: (
    mergedContent: string,
    newVersion: number,
    mergeLocalContent: string,
  ) => void;
  /** Called when conflicts are detected. Read `conflictState` from the
   *  hook's return value to access conflict details and remoteVersion. */
  onConflict: () => void;
  /** Called when merge is abandoned and falls back to refetch */
  onMergeFallback: () => void;
}

export function usePlateMerge({
  formId,
  baseContentRef,
  getCurrentEditorValue,
  setCurrentEditorValue,
  onMergeSuccess,
  onConflict,
  onMergeFallback,
}: UsePlateMergeOptions) {
  const [isMerging, setIsMerging] = useState(false);
  // Ref-based guard to avoid stale-closure issues with the state value
  // inside the recursive retry path of attemptMerge.
  const isMergingRef = useRef(false);
  const [conflictState, setConflictState] = useState<ConflictState | null>(
    null,
  );
  const conflictStateRef = useRef<ConflictState | null>(null);

  const retryCountRef = useRef(0);
  const mergeGenerationRef = useRef(0);

  const setCurrentConflictState = useCallback((state: ConflictState | null) => {
    conflictStateRef.current = state;
    setConflictState(state);
  }, []);

  const resetMergeState = useCallback(() => {
    mergeGenerationRef.current += 1;
    retryCountRef.current = 0;
    isMergingRef.current = false;
    setIsMerging(false);
    setCurrentConflictState(null);
  }, [setCurrentConflictState]);

  // Direct rpc() call instead of contentQuery.refetch() — the merge needs a
  // guaranteed fresh read that is NOT deduplicated or cached by React Query,
  // because the merge algorithm requires the exact server state at this instant.
  const fetchRemoteContent = useCallback(async () => {
    const data = await rpc(
      client.api.forms[":id"].content.$get({ param: { id: formId } }),
    );
    const version = data.plateContentVersion;
    if (version == null) {
      throw new Error("Server returned no plateContentVersion");
    }
    return {
      plateContent: data.plateContent ?? "[]",
      version,
    };
  }, [formId]);

  // Direct rpc() save — separate from contentMutation in form-editor-page
  // because the merge path needs fine-grained control over the 409 retry loop
  // and conflict-state transitions that don't fit the mutation's onSuccess/onError.
  const saveContent = useCallback(
    async (plateContent: string, expectedVersion: number) => {
      const data = await rpc(
        client.api.forms[":id"].content.$put({
          param: { id: formId },
          json: { plateContent, expectedVersion },
        }),
      );
      return data;
    },
    [formId],
  );

  /**
   * Attempt a 3-way merge after a 409 conflict or SSE document_changed.
   */
  const attemptMerge = useCallback(async () => {
    if (isMergingRef.current) return;
    const mergeGeneration = mergeGenerationRef.current;
    const isStaleMerge = () => mergeGeneration !== mergeGenerationRef.current;
    isMergingRef.current = true;
    setIsMerging(true);

    try {
      const remote = await fetchRemoteContent();
      if (isStaleMerge()) return;
      const localContent = getCurrentEditorValue();
      const baseContent = baseContentRef.current;

      // Parse all three versions
      let baseParsed: unknown[];
      let localParsed: unknown[];
      let remoteParsed: unknown[];
      try {
        baseParsed = JSON.parse(baseContent);
        localParsed = JSON.parse(localContent);
        remoteParsed = JSON.parse(remote.plateContent);
      } catch {
        onMergeFallback();
        toast.error("他のユーザーの変更を読み込みます。");
        return;
      }

      if (
        !Array.isArray(baseParsed) ||
        !Array.isArray(localParsed) ||
        !Array.isArray(remoteParsed)
      ) {
        onMergeFallback();
        toast.error("他のユーザーの変更を読み込みます。");
        return;
      }

      const mergeResult = mergePlateContent(
        baseParsed,
        localParsed,
        remoteParsed,
      );

      if (mergeResult.hasConflict) {
        // Reset retry budget so post-resolution saves get a fresh count
        retryCountRef.current = 0;
        setCurrentConflictState({
          result: mergeResult,
          remoteVersion: remote.version,
          generation: mergeGeneration,
        });
        onConflict();
        return;
      }

      // Auto-merge succeeded — save the merged content
      const mergedJson = JSON.stringify(mergeResult.merged);
      if (isStaleMerge()) return;
      try {
        const saveResult = await saveContent(mergedJson, remote.version);
        if (isStaleMerge()) return;
        if (saveResult && "plateContentVersion" in saveResult) {
          retryCountRef.current = 0;
          onMergeSuccess(
            mergedJson,
            saveResult.plateContentVersion,
            localContent,
          );
          toast.success("他のユーザーの変更と自動マージしました");
        } else {
          // Unexpected response format — treat as transient error
          retryCountRef.current = 0;
          onMergeFallback();
          toast.error("保存に失敗しました");
        }
      } catch (err) {
        if (isStaleMerge()) return;
        if (err instanceof RpcError && err.status === 409) {
          // Another save happened during merge — retry if under limit
          retryCountRef.current += 1;
          if (retryCountRef.current < MAX_MERGE_RETRIES) {
            // Release the guard so the recursive call can proceed
            isMergingRef.current = false;
            setIsMerging(false);
            await attemptMerge();
            // outer finally still runs — harmless, isMergingRef already false
            return;
          }
          retryCountRef.current = 0;
          onMergeFallback();
          toast.error(
            "他のユーザーが変更を保存しました。最新版を読み込みます。",
          );
        } else {
          retryCountRef.current = 0;
          onMergeFallback();
          toast.error("保存に失敗しました");
        }
      }
    } catch {
      if (isStaleMerge()) return;
      retryCountRef.current = 0;
      try {
        onMergeFallback();
      } catch {
        // swallow — already in error path; avoid double side-effects
      }
    } finally {
      // This is intentionally redundant after the retry path's early return:
      // the inner attemptMerge() call resets the guard in its own finally.
      // Keeping it here ensures the guard is always released on all exit paths
      // (success, non-409 error, max-retries exceeded) without branching.
      if (!isStaleMerge()) {
        isMergingRef.current = false;
        setIsMerging(false);
      }
    }
  }, [
    fetchRemoteContent,
    getCurrentEditorValue,
    baseContentRef,
    saveContent,
    onMergeSuccess,
    onConflict,
    onMergeFallback,
    setCurrentConflictState,
  ]);

  /**
   * Resolve conflicts and save the result.
   */
  const resolveConflicts = useCallback(
    async (resolutions: Record<string, "local" | "remote">) => {
      const currentConflictState = conflictStateRef.current;
      if (
        !currentConflictState ||
        currentConflictState.generation !== mergeGenerationRef.current ||
        isMergingRef.current
      ) {
        return;
      }
      const mergeGeneration = currentConflictState.generation;
      const isStaleMerge = () =>
        mergeGeneration !== mergeGenerationRef.current ||
        conflictStateRef.current !== currentConflictState;
      isMergingRef.current = true;
      setIsMerging(true);

      // Declared outside the try block so it's accessible in the catch
      // (for 409 retry), but computed inside try so that the finally block
      // resets isMergingRef if either call throws.
      let mergedJson = "";
      try {
        const resolved = applyConflictResolutions(
          currentConflictState.result,
          resolutions,
        );
        mergedJson = JSON.stringify(resolved);
        if (isStaleMerge()) return;
        const saveResult = await saveContent(
          mergedJson,
          currentConflictState.remoteVersion,
        );
        if (isStaleMerge()) return;
        if (saveResult && "plateContentVersion" in saveResult) {
          setCurrentConflictState(null);
          onMergeSuccess(
            mergedJson,
            saveResult.plateContentVersion,
            mergedJson,
          );
          toast.success("競合を解決しました");
        } else {
          // Unexpected response format — dismiss stale banner before refetch
          setCurrentConflictState(null);
          onMergeFallback();
          toast.error("保存に失敗しました");
        }
      } catch (err) {
        if (isStaleMerge()) return;
        if (err instanceof RpcError && err.status === 409) {
          // Preserve the conflict resolution result as the local value
          // so the subsequent attemptMerge uses it instead of stale editor state
          setCurrentEditorValue(mergedJson);
          // Update base to the resolved state so the retry merge only surfaces
          // changes made *after* the resolution, not re-conflicts from the
          // first remote.
          baseContentRef.current = mergedJson;
          setCurrentConflictState(null);
          // Release guard before recursive call
          isMergingRef.current = false;
          setIsMerging(false);
          await attemptMerge();
          return;
        }
        toast.error("保存に失敗しました");
      } finally {
        if (!isStaleMerge()) {
          isMergingRef.current = false;
          setIsMerging(false);
        }
      }
    },
    [
      saveContent,
      setCurrentConflictState,
      setCurrentEditorValue,
      onMergeSuccess,
      attemptMerge,
      onMergeFallback,
      baseContentRef,
    ],
  );

  const dismissConflict = useCallback(() => {
    setCurrentConflictState(null);
    onMergeFallback();
  }, [onMergeFallback, setCurrentConflictState]);

  return {
    attemptMerge,
    resolveConflicts,
    dismissConflict,
    resetMergeState,
    isMerging,
    isMergingRef,
    conflictState,
  };
}
