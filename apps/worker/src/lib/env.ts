/**
 * 環境変数のパースユーティリティ（Worker 用）
 */

/**
 * `setTimeout` / `AbortSignal.timeout()` が安全に扱える遅延の上限 (ms)。
 * これを超える値はタイマーが即時発火するなど予期しない挙動になる。
 */
export const MAX_TIMER_MS = 2_147_483_647;

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
