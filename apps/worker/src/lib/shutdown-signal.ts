const shutdownController = new AbortController();

/** Aborted when the worker begins graceful shutdown (SIGTERM/SIGINT). */
export const workerShutdownSignal = shutdownController.signal;

export function abortWorkerShutdown(reason?: unknown): void {
  if (workerShutdownSignal.aborted) return;
  shutdownController.abort(
    reason ?? new DOMException("Worker shutdown", "AbortError"),
  );
}
