import type { ValidationSSEEvent } from "@nexus-form/shared";
import { ValidationSSEEventSchema } from "@nexus-form/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { baseUrl } from "@/lib/api";
import { logWarn } from "@/lib/logger";

const MAX_CONSECUTIVE_SSE_ERRORS = 3;
const INITIAL_SSE_RECONNECT_DELAY_MS = 1_000;
const MAX_SSE_RECONNECT_DELAY_MS = 30_000;

/**
 * バリデーション結果のリアルタイム更新を SSE で受信し、
 * 関連する TanStack Query キャッシュを自動的に無効化するフック
 */
export function useValidationSSE(formId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const formIdRef = useRef(formId);
  formIdRef.current = formId;

  useEffect(() => {
    if (!formId) return;

    const url = `${baseUrl}/api/forms/${formId}/responses/events`;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelayMs = INITIAL_SSE_RECONNECT_DELAY_MS;

    const closeEventSource = () => {
      eventSource?.close();
      eventSource = null;
    };
    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const scheduleReconnect = () => {
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

    const connect = () => {
      if (document.hidden || eventSource !== null) return;

      const source = new EventSource(url, { withCredentials: true });
      eventSource = source;
      let consecutiveErrors = 0;

      source.addEventListener("open", () => {
        consecutiveErrors = 0;
        reconnectDelayMs = INITIAL_SSE_RECONNECT_DELAY_MS;
        clearReconnectTimer();
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

        const result = ValidationSSEEventSchema.safeParse(parsed);
        if (!result.success) {
          if (import.meta.env.DEV) {
            logWarn("Invalid validation SSE event received", "sse", {
              formId,
              issues: result.error.issues,
            });
          }
          return;
        }

        const event: ValidationSSEEvent = result.data;

        // バリデーション結果キャッシュを無効化
        void queryClient.invalidateQueries({
          queryKey: ["validationResults", formId, event.responseId],
        });

        // ステータス集計キャッシュを無効化
        void queryClient.invalidateQueries({
          queryKey: ["responseStatuses", formId],
        });
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearReconnectTimer();
        closeEventSource();
        return;
      }
      reconnectDelayMs = INITIAL_SSE_RECONNECT_DELAY_MS;
      void queryClient.invalidateQueries({
        queryKey: ["validationResults", formId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["responseStatuses", formId],
      });
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
