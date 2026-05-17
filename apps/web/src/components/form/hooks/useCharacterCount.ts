interface UseCharacterCountProps {
  value: string;
  maxLength?: number;
}

interface UseCharacterCountReturn {
  currentLength: number;
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
  value,
  maxLength,
}: UseCharacterCountProps): UseCharacterCountReturn => {
  const currentLength = value.length;

  const isOverLimit = maxLength ? currentLength > maxLength : false;
  const isNearLimit = maxLength ? currentLength > maxLength * 0.9 : false;

  const getCharacterCountDisplay = (): string | null => {
    if (!maxLength) return null;
    return `${currentLength}/${maxLength}`;
  };

  return {
    currentLength,
    isOverLimit,
    isNearLimit,
    getCharacterCountDisplay,
  };
};
