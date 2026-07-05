import { useCallback, useEffect, useRef, useState } from "react";

export type CopyFeedbackStatus = "idle" | "copied" | "failed";

interface UseCopyFeedbackOptions {
  resetAfterMs?: number;
}

interface UseCopyFeedbackReturn {
  status: CopyFeedbackStatus;
  markCopied: () => void;
  markFailed: () => void;
  reset: () => void;
}

/**
 * Tracks transient copy feedback state and resets non-idle states after a timer.
 *
 * Returns the current status plus actions for success, failure, and immediate reset.
 */
export function useCopyFeedback({
  resetAfterMs = 2000,
}: UseCopyFeedbackOptions = {}): UseCopyFeedbackReturn {
  const [status, setStatus] = useState<CopyFeedbackStatus>("idle");
  const resetTimerRef = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current === null) {
      return;
    }
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  const updateStatus = useCallback(
    (nextStatus: CopyFeedbackStatus) => {
      clearResetTimer();
      setStatus(nextStatus);

      if (nextStatus === "idle") {
        return;
      }

      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setStatus("idle");
      }, resetAfterMs);
    },
    [clearResetTimer, resetAfterMs],
  );

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const markCopied = useCallback(() => updateStatus("copied"), [updateStatus]);
  const markFailed = useCallback(() => updateStatus("failed"), [updateStatus]);
  const reset = useCallback(() => updateStatus("idle"), [updateStatus]);

  return {
    status,
    markCopied,
    markFailed,
    reset,
  };
}
