import type { ValidationSSEEvent } from "@nexus-form/shared";
import { ValidationSSEEventSchema } from "@nexus-form/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { baseUrl } from "@/lib/api";

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
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener("message", (e: MessageEvent<string>) => {
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

    return () => {
      eventSource.close();
    };
  }, [formId, queryClient]);
}
