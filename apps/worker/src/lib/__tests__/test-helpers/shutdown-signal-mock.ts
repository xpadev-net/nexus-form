export type ShutdownSignalMock = {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  reset: () => void;
};

export function createShutdownSignalMock(): ShutdownSignalMock {
  let controller = new AbortController();
  const signal = {
    get aborted(): boolean {
      return controller.signal.aborted;
    },
    get onabort(): AbortSignal["onabort"] {
      return controller.signal.onabort;
    },
    set onabort(value: AbortSignal["onabort"]) {
      controller.signal.onabort = value;
    },
    get reason(): unknown {
      return controller.signal.reason;
    },
    addEventListener(
      ...args: Parameters<AbortSignal["addEventListener"]>
    ): void {
      controller.signal.addEventListener(...args);
    },
    dispatchEvent(...args: Parameters<AbortSignal["dispatchEvent"]>): boolean {
      return controller.signal.dispatchEvent(...args);
    },
    removeEventListener(
      ...args: Parameters<AbortSignal["removeEventListener"]>
    ): void {
      controller.signal.removeEventListener(...args);
    },
    throwIfAborted(): void {
      controller.signal.throwIfAborted();
    },
  };

  return {
    signal,
    abort(reason?: unknown): void {
      controller.abort(
        reason ?? new DOMException("Worker shutdown", "AbortError"),
      );
    },
    reset(): void {
      controller = new AbortController();
    },
  };
}
