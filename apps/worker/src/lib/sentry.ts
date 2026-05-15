/**
 * Sentry エラー監視ユーティリティ (Worker)
 * SENTRY_DSN が設定されている場合のみ有効化される
 */

let sentryModule: typeof import("@sentry/node") | null = null;
let initialized = false;

export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || initialized) return;

  try {
    sentryModule = await import("@sentry/node");
    sentryModule.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1,
    });
    initialized = true;
    console.log("[sentry] Initialized for Worker");
  } catch {
    console.warn(
      "[sentry] Failed to initialize - @sentry/node may not be installed",
    );
  }
}

export function captureError(error: unknown): void {
  if (!sentryModule) return;
  sentryModule.captureException(error);
}

/**
 * バッファされた Sentry イベントの送信完了を待つ。
 * プロセス終了直前に呼び、イベント取りこぼしを防ぐ。
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentryModule) return;
  try {
    await sentryModule.flush(timeoutMs);
  } catch {
    // flush 失敗は終了処理を妨げない
  }
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  extra?: Record<string, unknown>,
): void {
  if (!sentryModule) return;
  sentryModule.captureMessage(message, {
    level,
    extra,
  });
}
