/**
 * Sentry エラー監視ユーティリティ
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
    console.log("[sentry] Initialized for API server");
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

export async function flushSentry(): Promise<void> {
  if (!sentryModule) return;
  await sentryModule.flush(2000);
}
