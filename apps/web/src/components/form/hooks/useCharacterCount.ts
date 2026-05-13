import { useCallback, useState } from "react";

interface UseCharacterCountProps {
  initialValue: string;
  maxLength?: number;
}

interface UseCharacterCountReturn {
  currentLength: number;
  updateLength: (newValue: string) => void;
  isOverLimit: boolean;
  isNearLimit: boolean;
  getCharacterCountDisplay: () => string | null;
}

/**
 * 文字数カウント用カスタムフック
 *
 * 機能:
 * - 文字数の追跡
 * - 制限チェック
 * - 表示用文字列の生成
 */
export const useCharacterCount = ({
  initialValue,
  maxLength,
}: UseCharacterCountProps): UseCharacterCountReturn => {
  const [currentLength, setCurrentLength] = useState(initialValue.length);

  const updateLength = useCallback((newValue: string) => {
    setCurrentLength(newValue.length);
  }, []);

  const isOverLimit = maxLength ? currentLength > maxLength : false;
  const isNearLimit = maxLength ? currentLength > maxLength * 0.9 : false;

  const getCharacterCountDisplay = useCallback((): string | null => {
    if (!maxLength) return null;
    return `${currentLength}/${maxLength}`;
  }, [currentLength, maxLength]);

  return {
    currentLength,
    updateLength,
    isOverLimit,
    isNearLimit,
    getCharacterCountDisplay,
  };
};
