import type { ValidationSSEEvent } from "@nexus-form/shared";
import { ValidationSSEEventSchema } from "@nexus-form/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { baseUrl } from "@/lib/api";

const MAX_CONSECUTIVE_SSE_ERRORS = 3;

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
    let stoppedAfterErrors = false;

    const closeEventSource = () => {
      eventSource?.close();
      eventSource = null;
    };

    const connect = () => {
      if (document.hidden || eventSource !== null || stoppedAfterErrors) return;

      const source = new EventSource(url, { withCredentials: true });
      eventSource = source;
      let consecutiveErrors = 0;

      source.addEventListener("open", () => {
        consecutiveErrors = 0;
      });

      source.addEventListener("error", () => {
        consecutiveErrors++;
        if (
          source.readyState === EventSource.CLOSED ||
          consecutiveErrors >= MAX_CONSECUTIVE_SSE_ERRORS
        ) {
          stoppedAfterErrors = true;
          if (eventSource === source) {
            closeEventSource();
          } else {
            source.close();
          }
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
        if (!result.success) return;

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
        closeEventSource();
        return;
      }
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeEventSource();
    };
  }, [formId, queryClient]);
}
