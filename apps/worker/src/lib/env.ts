/**
 * 環境変数のパースユーティリティ（Worker 用）
 */

/**
 * `setTimeout` / `AbortSignal.timeout()` が安全に扱える遅延の上限 (ms)。
 * これを超える値はタイマーが即時発火するなど予期しない挙動になる。
 */
export const MAX_TIMER_MS = 2_147_483_647;

/**
 * Safe bounds for the host-enforced validation plugin deadline (ms).
 *
 * The upper bound is intentionally lower than the Node.js timer limit so a
 * misconfigured plugin deadline cannot hold a Worker job for an operationally
 * unbounded period.
 */
export const VALIDATION_PLUGIN_TIMEOUT_DEFAULT_MS = 60_000;
export const VALIDATION_PLUGIN_TIMEOUT_MIN_MS = 1_000;
export const VALIDATION_PLUGIN_TIMEOUT_MAX_MS = 300_000;

/**
 * 正の整数の環境変数を読み取る。
 *
 * 未設定・整数でない・0 以下・`max` 超過のいずれの場合も `defaultValue`
 * にフォールバックし、不正値のときは警告ログを出す。タイムアウト値などに
 * 不正値が混入して `AbortSignal.timeout()` が実行時に例外を投げたり、
 * タイマーが即時発火したりするのを防ぐ。
 */
export function parsePositiveIntEnv(
  name: string,
  defaultValue: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    console.warn(
      `[env] ${name}="${raw}" is not a positive integer<=${max}; falling back to ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

/**
 * Resolve the host-enforced validation plugin deadline from
 * `VALIDATION_PLUGIN_TIMEOUT_MS`.
 *
 * Missing or empty values use the default without a warning. Malformed,
 * non-positive, fractional, and over-limit values use the default and log a
 * warning. Positive values below the operational minimum are clamped to that
 * minimum and log a warning.
 */
export function getValidationPluginTimeoutMs(): number {
  const parsed = parsePositiveIntEnv(
    "VALIDATION_PLUGIN_TIMEOUT_MS",
    VALIDATION_PLUGIN_TIMEOUT_DEFAULT_MS,
    VALIDATION_PLUGIN_TIMEOUT_MAX_MS,
  );
  if (parsed < VALIDATION_PLUGIN_TIMEOUT_MIN_MS) {
    console.warn(
      `[env] VALIDATION_PLUGIN_TIMEOUT_MS="${parsed}" is below the minimum of ${VALIDATION_PLUGIN_TIMEOUT_MIN_MS}ms; clamping to ${VALIDATION_PLUGIN_TIMEOUT_MIN_MS}ms`,
    );
    return VALIDATION_PLUGIN_TIMEOUT_MIN_MS;
  }
  return parsed;
}
