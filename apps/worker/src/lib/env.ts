/**
 * 環境変数のパースユーティリティ（Worker 用）
 */

/**
 * 正の整数の環境変数を読み取る。
 *
 * 未設定・数値でない・0 以下の場合は `defaultValue` にフォールバックし、
 * 不正値のときは警告ログを出す。タイムアウト値などに不正値が混入して
 * `AbortSignal.timeout()` が実行時 `TypeError` を投げるのを防ぐ。
 */
export function parsePositiveIntEnv(
  name: string,
  defaultValue: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[env] ${name}="${raw}" is not a positive number; falling back to ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}
