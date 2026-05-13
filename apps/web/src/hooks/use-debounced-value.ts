import { useEffect, useState } from "react";

/**
 * 値の変更をdebounceする汎用フック。
 * 指定した遅延時間が経過するまで新しい値への更新を保留する。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
