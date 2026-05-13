import type { FC } from "react";
import { useEffect, useState } from "react";

/**
 * 自動保存状態インジケーターのプロパティ
 */
export interface AutosaveIndicatorProps {
  /** 保存中かどうか */
  isSaving: boolean;
  /** 最終保存時刻 */
  lastSaved: Date | null;
  /** エラーメッセージ */
  error: string | null;
  /** カスタムクラス名 */
  className?: string;
}

/**
 * 相対時間を日本語で表示する
 *
 * @param date - 日時
 * @returns 相対時間の文字列（例: "たった今"、"3分前"、"1時間前"）
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 10) {
    return "たった今";
  }
  if (diffSeconds < 60) {
    return `${diffSeconds}秒前`;
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}分前`;
  }
  if (diffHours < 24) {
    return `${diffHours}時間前`;
  }
  if (diffDays === 1) {
    return "昨日";
  }
  return `${diffDays}日前`;
}

/**
 * 自動保存状態表示UIコンポーネント
 *
 * 自動保存の状態をユーザーに視覚的に表示する控えめなインジケーター。
 *
 * @example
 * ```tsx
 * const { isSaving, lastSaved, error } = useAutosave(formId, responses);
 * <AutosaveIndicator isSaving={isSaving} lastSaved={lastSaved} error={error} />
 * ```
 */
export const AutosaveIndicator: FC<AutosaveIndicatorProps> = ({
  isSaving,
  lastSaved,
  error,
  className = "",
}) => {
  // 相対時間表示を更新するための状態
  const [, setUpdateTrigger] = useState(0);

  // 1分ごとに相対時間表示を更新
  useEffect(() => {
    if (!lastSaved) return;

    const interval = window.setInterval(() => {
      setUpdateTrigger((prev) => prev + 1);
    }, 60000); // 1分ごと

    return () => {
      window.clearInterval(interval);
    };
  }, [lastSaved]);

  // エラー状態
  if (error) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role="status" is semantically appropriate for this status indicator
      <div
        className={`inline-flex items-center gap-2 text-sm text-red-600 ${className}`}
        role="status"
        aria-live="polite"
      >
        <span className="text-base" aria-hidden="true">
          ⚠️
        </span>
        <span>{error}</span>
      </div>
    );
  }

  // 保存中
  if (isSaving) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role="status" is semantically appropriate for this status indicator
      <div
        className={`inline-flex items-center gap-2 text-sm text-muted-foreground ${className}`}
        role="status"
        aria-live="polite"
        aria-label="保存中"
      >
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-foreground"
          aria-hidden="true"
        />
        <span>保存中...</span>
      </div>
    );
  }

  // 保存済み
  if (lastSaved) {
    const relativeTime = formatRelativeTime(lastSaved);
    return (
      // biome-ignore lint/a11y/useSemanticElements: role="status" is semantically appropriate for this status indicator
      <div
        className={`inline-flex items-center gap-2 text-sm text-muted-foreground ${className}`}
        role="status"
        aria-live="polite"
        aria-label={`下書きを保存しました。${relativeTime}`}
      >
        <span className="text-green-600 text-base" aria-hidden="true">
          ✓
        </span>
        <span className="text-muted-foreground">
          下書き保存済み
          <span className="hidden sm:inline">: {relativeTime}</span>
        </span>
      </div>
    );
  }

  // 何も表示しない（初期状態）
  return null;
};
