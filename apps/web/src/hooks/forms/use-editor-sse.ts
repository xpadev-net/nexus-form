import type { EditorSSEEvent } from "@nexus-form/shared";
import { EditorSSEEventSchema } from "@nexus-form/shared";
import { useQueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import {
  baseUrl,
  getShareTokenFromCurrentUrl,
  withShareTokenSearchParam,
} from "@/lib/api";
import { logWarn } from "@/lib/logger";
import { formDiffQueryKey } from "./form-structure-query-keys";

const MAX_CONSECUTIVE_SSE_ERRORS = 3;
const INITIAL_SSE_RECONNECT_DELAY_MS = 1_000;
const MAX_SSE_RECONNECT_DELAY_MS = 30_000;

type EditorSSEOptions = {
  /** イベント受信時のコールバック（useQuery を使わないコンポーネント向け） */
  onEvent?: (event: EditorSSEEvent) => void;
  /** 保留中の未保存値を追跡する ref。非 null の場合、document_changed の反映を抑制する */
  pendingValueRef?: MutableRefObject<string | null>;
  /** 直前に自分が保存したバージョンを追跡する ref。自分自身の保存による SSE エコーをスキップする */
  lastSavedVersionRef?: MutableRefObject<number | null>;
  /** pending 変更がある状態で document_changed を受信した際に 3-way merge を試行する */
  onMergeNeeded?: () => void;
  /** コンフリクト解決中かどうかを示す ref。true の間は document_changed を無視する */
  isConflictActiveRef?: MutableRefObject<boolean>;
};

/**
 * フォーム編集のリアルタイム更新を SSE で受信し、
 * 関連する TanStack Query キャッシュを自動的に無効化するフック
 *
 * onEvent コールバックを渡すと、useQuery を使わないコンポーネントでも
 * イベントに反応して手動リフレッシュ等を実行できる
 */
export function useEditorSSE(
  formId: string | null | undefined,
  options?: EditorSSEOptions,
): void {
  const queryClient = useQueryClient();
  const _shareToken = getShareTokenFromCurrentUrl();
  const onEventRef = useRef(options?.onEvent);
  onEventRef.current = options?.onEvent;

  // Store option refs inside hook-owned refs so they are stable across renders
  // and don't trigger the exhaustive-deps lint rule.
  const pendingValueRefRef = useRef(options?.pendingValueRef);
  pendingValueRefRef.current = options?.pendingValueRef;
  const lastSavedVersionRefRef = useRef(options?.lastSavedVersionRef);
  lastSavedVersionRefRef.current = options?.lastSavedVersionRef;
  const onMergeNeededRef = useRef(options?.onMergeNeeded);
  onMergeNeededRef.current = options?.onMergeNeeded;
  const isConflictActiveRefRef = useRef(options?.isConflictActiveRef);
  isConflictActiveRefRef.current = options?.isConflictActiveRef;

  useEffect(() => {
    if (!formId) return;

    const url = withShareTokenSearchParam(
      `${baseUrl}/api/forms/${formId}/editor/events`,
    );
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelayMs = INITIAL_SSE_RECONNECT_DELAY_MS;
    let consecutiveErrors = 0;

    const closeEventSource = (): void => {
      eventSource?.close();
      eventSource = null;
    };
    const clearReconnectTimer = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const scheduleReconnect = (): void => {
      if (document.hidden || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(
        reconnectDelayMs * 2,
        MAX_SSE_RECONNECT_DELAY_MS,
      );
    };

    const connect = (): void => {
      if (document.hidden || eventSource !== null) return;

      const source = new EventSource(url, { withCredentials: true });
      eventSource = source;

      source.addEventListener("open", () => {
        consecutiveErrors = 0;
        reconnectDelayMs = INITIAL_SSE_RECONNECT_DELAY_MS;
      });

      source.addEventListener("error", () => {
        consecutiveErrors++;
        const reachedErrorLimit =
          consecutiveErrors >= MAX_CONSECUTIVE_SSE_ERRORS;
        if (source.readyState === EventSource.CLOSED || reachedErrorLimit) {
          if (eventSource === source) {
            closeEventSource();
          } else {
            source.close();
          }
          scheduleReconnect();
        }
      });

      source.addEventListener("message", (e: MessageEvent<string>) => {
        consecutiveErrors = 0;
        let parsed: unknown;
        try {
          parsed = JSON.parse(e.data);
        } catch {
          return;
        }

        const result = EditorSSEEventSchema.safeParse(parsed);
        if (!result.success) {
          if (import.meta.env.DEV) {
            logWarn("Invalid editor SSE event received", "sse", {
              formId,
              issues: result.error.issues,
            });
          }
          return;
        }

        const event: EditorSSEEvent = result.data;

        // コールバックがあれば呼び出す
        onEventRef.current?.(event);

        // イベント種別に応じてキャッシュを無効化
        if (event.type === "document_changed") {
          const lastSavedRef = lastSavedVersionRefRef.current;
          const lastSavedVersion = lastSavedRef?.current ?? null;
          // 自分自身の保存によるエコーをスキップ（完全一致のみ）。
          if (
            lastSavedRef != null &&
            lastSavedVersion != null &&
            event.version === lastSavedVersion
          ) {
            lastSavedRef.current = null; // 一度消費したらリセット
            return;
          }
          // コンフリクト解決中は document_changed を無視する。
          // refetch するとエディタ内容が書き換わり、解決 UI の状態と齟齬が生じる。
          if (isConflictActiveRefRef.current?.current) {
            return;
          }
          const pendingVal = pendingValueRefRef.current;
          // debounce 中の未保存編集がある場合、3-way merge を試行する。
          // merge コールバックが未設定の場合は従来通り抑制する。
          if (pendingVal?.current != null) {
            onMergeNeededRef.current?.();
            return;
          }
          void queryClient.invalidateQueries({
            queryKey: ["formContent", formId],
          });
          void queryClient.invalidateQueries({
            queryKey: formDiffQueryKey(formId),
          });
        }
      });
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        clearReconnectTimer();
        closeEventSource();
        return;
      }
      reconnectDelayMs = INITIAL_SSE_RECONNECT_DELAY_MS;
      const pendingVal = pendingValueRefRef.current;
      if (pendingVal?.current != null && onMergeNeededRef.current != null) {
        onMergeNeededRef.current();
      } else {
        void queryClient.invalidateQueries({
          queryKey: ["formContent", formId],
        });
        void queryClient.invalidateQueries({
          queryKey: formDiffQueryKey(formId),
        });
      }
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      closeEventSource();
    };
  }, [formId, queryClient]);
}
